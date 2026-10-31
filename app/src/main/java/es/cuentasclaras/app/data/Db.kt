package es.cuentasclaras.app.data

import android.content.Context
import androidx.room.Dao
import androidx.room.Database
import androidx.room.Entity
import androidx.room.PrimaryKey
import androidx.room.Query
import androidx.room.Room
import androidx.room.RoomDatabase
import androidx.room.Upsert
import kotlinx.coroutines.flow.Flow

// Importes en céntimos (Long) y fechas en texto ISO-8601: sin pérdidas ni zonas horarias ambiguas.

@Entity(tableName = "accounts")
data class AccountEntity(
    @PrimaryKey val id: String,
    val ownerId: String,
    val name: String,
    val type: String,
    val openingCents: Long,
    val liquid: Boolean,
    val archived: Boolean = false,
    val updatedAt: Long = System.currentTimeMillis(),
)

@Entity(tableName = "transactions")
data class TxEntity(
    @PrimaryKey val id: String,
    val ownerId: String,
    val kind: String,
    val amountCents: Long,
    val dateTime: String,
    val status: String,
    val accountId: String?,
    val toAccountId: String?,
    val concept: String,
    val categoryId: String?,
    val notes: String,
    val planned: Boolean,
    val estimated: Boolean,
    val recurrenceId: String?,
    val refundOf: String?,
    val deleted: Boolean = false,
    val updatedAt: Long = System.currentTimeMillis(),
)

@Entity(tableName = "categories")
data class CategoryEntity(
    @PrimaryKey val id: String,
    val name: String,
    val parentId: String?,
    val limitCents: Long?,
    val forIncome: Boolean = false,
)

@Entity(tableName = "recurrences")
data class RecurrenceEntity(
    @PrimaryKey val id: String,
    val templateTxId: String,
    val frequency: String,
    val interval: Int,
    val startDate: String,
    val endDate: String?,
    val count: Int?,
    val time: String,
    val active: Boolean = true,
    // Plantilla
    val kind: String,
    val amountCents: Long,
    val accountId: String?,
    val toAccountId: String?,
    val concept: String,
    val categoryId: String?,
    val estimated: Boolean,
)

@Entity(tableName = "goals")
data class GoalEntity(
    @PrimaryKey val id: String,
    val name: String,
    val targetCents: Long,
    val monthlyCents: Long,
    val heldInLiquid: Boolean,
    val active: Boolean = true,
)

@Entity(tableName = "contributions")
data class ContributionEntity(
    @PrimaryKey val id: String,
    val goalId: String,
    val amountCents: Long,
    val date: String,
)

@Entity(tableName = "settings")
data class SettingEntity(@PrimaryKey val key: String, val value: String)

@Dao
interface FinanceDao {
    @Query("SELECT * FROM accounts WHERE archived = 0 ORDER BY name") fun accounts(): Flow<List<AccountEntity>>
    @Upsert suspend fun upsertAccount(a: AccountEntity)

    @Query("SELECT * FROM transactions WHERE deleted = 0") fun transactions(): Flow<List<TxEntity>>
    @Query("SELECT id FROM transactions") suspend fun allTxIds(): List<String>
    @Query("SELECT * FROM transactions WHERE id = :id") suspend fun tx(id: String): TxEntity?
    @Upsert suspend fun upsertTx(t: TxEntity)
    @Upsert suspend fun upsertTxs(t: List<TxEntity>)
    @Query("UPDATE transactions SET deleted = 1, updatedAt = :now WHERE id = :id") suspend fun deleteTx(id: String, now: Long = System.currentTimeMillis())

    @Query("SELECT * FROM categories ORDER BY name") fun categories(): Flow<List<CategoryEntity>>
    @Upsert suspend fun upsertCategory(c: CategoryEntity)
    @Upsert suspend fun upsertCategories(c: List<CategoryEntity>)

    @Query("SELECT * FROM recurrences WHERE active = 1") fun recurrences(): Flow<List<RecurrenceEntity>>
    @Query("SELECT * FROM recurrences WHERE active = 1") suspend fun recurrencesNow(): List<RecurrenceEntity>
    @Upsert suspend fun upsertRecurrence(r: RecurrenceEntity)
    @Query("UPDATE recurrences SET active = 0 WHERE id = :id") suspend fun stopRecurrence(id: String)

    @Query("SELECT * FROM goals WHERE active = 1") fun goals(): Flow<List<GoalEntity>>
    @Upsert suspend fun upsertGoal(g: GoalEntity)
    @Query("SELECT * FROM contributions") fun contributions(): Flow<List<ContributionEntity>>
    @Upsert suspend fun upsertContribution(c: ContributionEntity)

    @Query("SELECT * FROM settings") fun settings(): Flow<List<SettingEntity>>
    @Upsert suspend fun putSetting(s: SettingEntity)
}

@Database(
    entities = [AccountEntity::class, TxEntity::class, CategoryEntity::class, RecurrenceEntity::class,
        GoalEntity::class, ContributionEntity::class, SettingEntity::class],
    version = 1,
    exportSchema = true,
)
abstract class AppDb : RoomDatabase() {
    abstract fun dao(): FinanceDao

    companion object {
        /** Datos reales y de demostración viven en archivos distintos: nunca se mezclan. */
        fun open(context: Context, demo: Boolean): AppDb =
            Room.databaseBuilder(context, AppDb::class.java, if (demo) "demo.db" else "cuentas.db").build()
    }
}
