package es.cuentasclaras.app.data

import es.cuentasclaras.core.budget.BudgetSettings
import es.cuentasclaras.core.model.Account
import es.cuentasclaras.core.model.AccountType
import es.cuentasclaras.core.model.Category
import es.cuentasclaras.core.model.CategoryLimit
import es.cuentasclaras.core.model.Goal
import es.cuentasclaras.core.model.GoalContribution
import es.cuentasclaras.core.model.Transaction
import es.cuentasclaras.core.model.TxKind
import es.cuentasclaras.core.model.TxStatus
import es.cuentasclaras.core.money.Money
import es.cuentasclaras.core.recurrence.Frequency
import es.cuentasclaras.core.recurrence.RecurrenceExpander
import es.cuentasclaras.core.recurrence.RecurrenceRule
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.combine
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.LocalTime
import java.util.UUID

/** Usuario local hasta que llegue la fase 3 (cuentas y pareja). */
const val ME = "yo"

data class Settings(
    val nextPayday: LocalDate? = null,
    val buffer: Money = Money.ZERO,
    val monthlySavings: Money = Money.ZERO,
    val sarcasm: Int = 2,
    val reduceMotion: Boolean = false,
    val quality: String = "alta",
    val assistantName: String = "Vera",
    val remarks: Boolean = true,
) {
    fun budget() = BudgetSettings(buffer = buffer, monthlySavings = monthlySavings, nextPayday = nextPayday)
}

data class Snapshot(
    val accounts: List<Account>,
    val transactions: List<Transaction>,
    val categories: List<Category>,
    val limits: List<CategoryLimit>,
    val incomeCategoryIds: Set<String>,
    val recurrences: List<RecurrenceEntity>,
    val goals: List<Goal>,
    val contributions: List<GoalContribution>,
    val settings: Settings,
)

class Repository(private val db: AppDb) {
    private val dao = db.dao()

    val snapshot: Flow<Snapshot> = combine(
        combine(dao.accounts(), dao.transactions(), dao.categories()) { a, t, c -> Triple(a, t, c) },
        combine(dao.recurrences(), dao.goals(), dao.contributions(), dao.settings()) { r, g, co, s -> listOf(r, g, co, s) },
    ) { (a, t, c), rest ->
        @Suppress("UNCHECKED_CAST")
        val r = rest[0] as List<RecurrenceEntity>
        @Suppress("UNCHECKED_CAST")
        val g = rest[1] as List<GoalEntity>
        @Suppress("UNCHECKED_CAST")
        val co = rest[2] as List<ContributionEntity>
        @Suppress("UNCHECKED_CAST")
        val s = rest[3] as List<SettingEntity>
        Snapshot(
            accounts = a.map { it.toModel() },
            transactions = t.mapNotNull { runCatching { it.toModel() }.getOrNull() },
            categories = c.map { Category(it.id, it.name, it.parentId) },
            limits = c.filter { it.limitCents != null }.map { CategoryLimit(it.id, Money(it.limitCents!!)) },
            incomeCategoryIds = c.filter { it.forIncome }.map { it.id }.toSet(),
            recurrences = r,
            goals = g.map { Goal(it.id, ME, it.name, Money(it.targetCents), Money(it.monthlyCents), it.heldInLiquid) },
            contributions = co.map { GoalContribution(it.goalId, Money(it.amountCents), LocalDate.parse(it.date)) },
            settings = s.associate { it.key to it.value }.toSettings(),
        )
    }

    // ---------- Escritura ----------
    /** Insertar o reemplazar por id: un reintento nunca duplica. */
    suspend fun save(tx: Transaction) = dao.upsertTx(tx.toEntity())
    suspend fun delete(id: String) = dao.deleteTx(id)
    suspend fun confirm(id: String) {
        val e = dao.tx(id) ?: return
        dao.upsertTx(e.copy(status = TxStatus.REALIZADO.name, estimated = false, updatedAt = System.currentTimeMillis()))
    }
    suspend fun saveAccount(a: Account) = dao.upsertAccount(
        AccountEntity(a.id, a.ownerId, a.name, a.type.name, a.openingBalance.cents, a.liquid, a.archived),
    )
    suspend fun setLimit(c: CategoryEntity) = dao.upsertCategory(c)
    suspend fun addCategory(name: String, parentId: String?, income: Boolean) =
        dao.upsertCategory(CategoryEntity(UUID.randomUUID().toString(), name, parentId, null, income))
    suspend fun put(key: String, value: String) = dao.putSetting(SettingEntity(key, value))
    suspend fun saveGoal(g: GoalEntity) = dao.upsertGoal(g)
    suspend fun contribute(goalId: String, amount: Money) =
        dao.upsertContribution(ContributionEntity(UUID.randomUUID().toString(), goalId, amount.cents, LocalDate.now().toString()))

    suspend fun addRecurrence(template: Transaction, frequency: Frequency, count: Int?) {
        val id = "r-" + UUID.randomUUID().toString().take(8)
        dao.upsertRecurrence(
            RecurrenceEntity(
                id = id, templateTxId = template.id, frequency = frequency.name, interval = 1,
                startDate = template.date.toString(), endDate = null, count = count, time = template.dateTime.toLocalTime().toString(),
                kind = template.kind.name, amountCents = template.amount.cents, accountId = template.accountId,
                toAccountId = template.toAccountId, concept = template.concept, categoryId = template.categoryId, estimated = template.estimated,
            ),
        )
        materialize()
    }
    suspend fun stopRecurrence(id: String) = dao.stopRecurrence(id)

    /** Genera los previstos de los recurrentes para los próximos 62 días. Idempotente. */
    suspend fun materialize(today: LocalDate = LocalDate.now()) {
        val existing = dao.allTxIds().toSet()
        val created = dao.recurrencesNow().flatMap { r ->
            val rule = r.toRule()
            RecurrenceExpander.materialize(rule, rule.start, today.plusDays(62), existing)
                // Las ocurrencias pasadas que nunca se crearon se dejan como pendientes para que las confirmes.
                .map { it.toEntity() }
        }
        if (created.isNotEmpty()) dao.upsertTxs(created)
    }

    suspend fun seedIfEmpty(demo: Boolean) {
        if (dao.allTxIds().isNotEmpty() || dao.recurrencesNow().isNotEmpty()) return
        dao.upsertCategories(DefaultData.categories)
        if (demo) DefaultData.seedDemo(this) else DefaultData.seedReal(this)
    }
}

// ---------- Conversión ----------
private fun AccountEntity.toModel() = Account(id, ownerId, name, AccountType.valueOf(type), Money(openingCents), liquid, archived = archived)

private fun TxEntity.toModel() = Transaction(
    id = id, ownerId = ownerId, kind = TxKind.valueOf(kind), amount = Money(amountCents), dateTime = LocalDateTime.parse(dateTime),
    status = TxStatus.valueOf(status), accountId = accountId, toAccountId = toAccountId, concept = concept, categoryId = categoryId,
    notes = notes, planned = planned, estimated = estimated, recurrenceId = recurrenceId, refundOf = refundOf, deleted = deleted,
)

fun Transaction.toEntity() = TxEntity(
    id = id, ownerId = ownerId, kind = kind.name, amountCents = amount.cents, dateTime = dateTime.withNano(0).toString(),
    status = status.name, accountId = accountId, toAccountId = toAccountId, concept = concept, categoryId = categoryId, notes = notes,
    planned = planned, estimated = estimated, recurrenceId = recurrenceId, refundOf = refundOf, deleted = deleted,
)

fun RecurrenceEntity.toRule() = RecurrenceRule(
    id = id,
    template = Transaction(
        id = templateTxId, ownerId = ME, kind = TxKind.valueOf(kind), amount = Money(amountCents), dateTime = LocalDate.parse(startDate).atTime(LocalTime.parse(time)),
        status = TxStatus.PREVISTO, accountId = accountId, toAccountId = toAccountId, concept = concept, categoryId = categoryId,
        planned = true, estimated = estimated,
    ),
    frequency = Frequency.valueOf(frequency), interval = interval, start = LocalDate.parse(startDate),
    end = endDate?.let { LocalDate.parse(it) }, count = count, time = LocalTime.parse(time), active = active,
)

private fun Map<String, String>.toSettings() = Settings(
    nextPayday = this["nextPayday"]?.takeIf { it.isNotBlank() }?.let { runCatching { LocalDate.parse(it) }.getOrNull() },
    buffer = Money(this["buffer"]?.toLongOrNull() ?: 0),
    monthlySavings = Money(this["monthlySavings"]?.toLongOrNull() ?: 0),
    sarcasm = this["sarcasm"]?.toIntOrNull() ?: 2,
    reduceMotion = this["reduceMotion"] == "true",
    quality = this["quality"] ?: "alta",
    assistantName = this["assistantName"]?.takeIf { it.isNotBlank() } ?: "Vera",
    remarks = this["remarks"] != "false",
)

fun newId(): String = UUID.randomUUID().toString()
