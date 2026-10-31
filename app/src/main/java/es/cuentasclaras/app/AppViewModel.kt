package es.cuentasclaras.app

import android.app.Application
import android.content.Context
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import es.cuentasclaras.app.data.AppDb
import es.cuentasclaras.app.data.ME
import es.cuentasclaras.app.data.Repository
import es.cuentasclaras.app.data.Snapshot
import es.cuentasclaras.app.data.newId
import es.cuentasclaras.app.vera.VeraCommand
import es.cuentasclaras.app.vera.VeraLines
import es.cuentasclaras.core.budget.BudgetEngine
import es.cuentasclaras.core.budget.BudgetInput
import es.cuentasclaras.core.budget.BudgetResult
import es.cuentasclaras.core.budget.HorizonKind
import es.cuentasclaras.core.dedup.Duplicates
import es.cuentasclaras.core.model.AccountType
import es.cuentasclaras.core.model.Transaction
import es.cuentasclaras.core.model.TxKind
import es.cuentasclaras.core.model.TxStatus
import es.cuentasclaras.core.parse.PaymentHint
import es.cuentasclaras.core.parse.QuickEntryParser
import es.cuentasclaras.core.recurrence.Frequency
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import java.time.LocalDateTime

data class UiState(
    val snap: Snapshot,
    val toPayday: BudgetResult,
    val toMonthEnd: BudgetResult,
    val now: LocalDateTime,
    val demo: Boolean,
)

/** Borrador editable antes de guardar (texto, voz o formulario). Su id se fija al crearlo: guardar dos veces no duplica. */
data class DraftTx(
    val id: String = newId(),
    val kind: TxKind,
    val amountText: String,
    val concept: String,
    val categoryId: String?,
    val accountId: String?,
    val dateTime: LocalDateTime,
    val duplicateOf: String? = null,
)

@OptIn(ExperimentalCoroutinesApi::class)
class AppViewModel(app: Application) : AndroidViewModel(app) {
    private val prefs = app.getSharedPreferences("app", Context.MODE_PRIVATE)
    private val demoFlag = MutableStateFlow(prefs.getBoolean("demo", true))
    private val dbs = mutableMapOf<Boolean, Repository>()
    private fun repo(demo: Boolean = demoFlag.value) = dbs.getOrPut(demo) { Repository(AppDb.open(getApplication(), demo)) }
    val repo: Repository get() = repo()

    private val _vera = MutableSharedFlow<VeraCommand>(extraBufferCapacity = 16)
    val vera = _vera.asSharedFlow()

    val drafts = MutableStateFlow<List<DraftTx>>(emptyList())

    val state: StateFlow<UiState?> = demoFlag.flatMapLatest { demo ->
        val r = repo(demo)
        viewModelScope.launch { r.seedIfEmpty(demo); r.materialize() }
        r.snapshot.map { snap -> compute(snap, demo) }
    }.stateIn(viewModelScope, SharingStarted.Eagerly, null)

    private fun compute(snap: Snapshot, demo: Boolean): UiState {
        val now = LocalDateTime.now()
        val input = BudgetInput(
            userId = ME, now = now, accounts = snap.accounts, transactions = snap.transactions, settings = snap.settings.budget(),
            goals = snap.goals, contributions = snap.contributions, categories = snap.categories, limits = snap.limits,
        )
        return UiState(snap, BudgetEngine.compute(input, HorizonKind.HASTA_COBRO), BudgetEngine.compute(input, HorizonKind.FIN_DE_MES), now, demo)
    }

    fun say(cmd: VeraCommand) { _vera.tryEmit(cmd) }

    fun sendConfig() {
        val s = state.value ?: return
        say(VeraCommand.Config(s.snap.settings.sarcasm, s.snap.settings.reduceMotion, s.snap.settings.quality, VeraLines.remarks(s)))
    }

    fun greet() {
        val s = state.value ?: return
        sendConfig()
        say(VeraCommand.Speak(VeraLines.hello(s), VeraLines.moodFor(s.snap.settings.sarcasm)))
    }

    fun setDemo(on: Boolean) {
        prefs.edit().putBoolean("demo", on).apply()
        demoFlag.value = on
    }

    // ---------- Entrada rápida (texto o dictado) ----------
    fun quickEntry(text: String) {
        val s = state.value ?: return
        val parsed = QuickEntryParser.parse(text, LocalDateTime.now())
        if (parsed.drafts.isEmpty()) {
            say(VeraCommand.Speak(VeraLines.notUnderstood(s.snap.settings.sarcasm), "neutral"))
            return
        }
        drafts.value = parsed.drafts.map { d ->
            val accountId = when (d.payment) {
                PaymentHint.EFECTIVO -> s.snap.accounts.firstOrNull { it.type == AccountType.EFECTIVO }?.id
                null -> null
                else -> s.snap.accounts.firstOrNull { it.type == AccountType.CORRIENTE || it.type == AccountType.TARJETA }?.id
            } ?: s.snap.accounts.firstOrNull { it.liquid }?.id
            val cat = d.categoryKey?.takeIf { key -> s.snap.categories.any { it.id == key } }
            DraftTx(kind = d.kind, amountText = d.amount?.format()?.replace(" €", "") ?: "", concept = d.concept,
                categoryId = cat ?: if (d.kind == TxKind.INGRESO) "ing-extra" else "otros", accountId = accountId, dateTime = d.dateTime)
        }.map { it.withDuplicateCheck(s) }
        say(VeraCommand.Speak(VeraLines.draftsReady(drafts.value.size, s.snap.settings.sarcasm), "neutral", "atencion"))
    }

    private fun DraftTx.withDuplicateCheck(s: UiState): DraftTx {
        val tx = toTx() ?: return this
        return copy(duplicateOf = Duplicates.suspects(tx, s.snap.transactions).firstOrNull()?.concept)
    }

    fun updateDraft(d: DraftTx) { drafts.value = drafts.value.map { if (it.id == d.id) d.withDuplicateCheck(state.value!!) else it } }
    fun discardDrafts() { drafts.value = emptyList(); say(VeraCommand.Speak(VeraLines.discarded(state.value?.snap?.settings?.sarcasm ?: 2), VeraLines.moodFor(state.value?.snap?.settings?.sarcasm ?: 2))) }

    fun confirmDrafts() {
        val list = drafts.value.mapNotNull { it.toTx() }
        drafts.value = emptyList()
        viewModelScope.launch {
            list.forEach { repo.save(it) }
            reactToSaved(list)
        }
    }

    // ---------- Formulario ----------
    fun saveTx(tx: Transaction, repeat: Frequency?) = viewModelScope.launch {
        repo.save(tx)
        if (repeat != null) repo.addRecurrence(tx.copy(status = TxStatus.PREVISTO, planned = true), repeat, null)
        reactToSaved(listOf(tx))
    }
    fun deleteTx(id: String) = viewModelScope.launch { repo.delete(id) }
    fun confirmTx(id: String) = viewModelScope.launch { repo.confirm(id) }

    private suspend fun reactToSaved(list: List<Transaction>) {
        kotlinx.coroutines.delay(150) // espera al recálculo
        val s = state.value ?: return
        val (text, mood, st) = VeraLines.afterSaving(list, s)
        say(VeraCommand.Speak(text, mood, st))
    }

    fun put(key: String, value: String) = viewModelScope.launch { repo.put(key, value) }

    fun explain() {
        val s = state.value ?: return
        say(VeraCommand.Speak(VeraLines.explain(s), VeraLines.moodFor(s.snap.settings.sarcasm)))
    }
}

fun DraftTx.toTx(): Transaction? {
    val amount = es.cuentasclaras.core.money.Money.parse(amountText)?.takeIf { it.isPositive } ?: return null
    val future = dateTime.isAfter(LocalDateTime.now().plusMinutes(1))
    return Transaction(
        id = id, ownerId = ME, kind = kind, amount = amount, dateTime = dateTime,
        status = if (future) TxStatus.PREVISTO else TxStatus.REALIZADO, planned = future,
        accountId = accountId, concept = concept.trim(), categoryId = categoryId,
    )
}
