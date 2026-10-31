package es.cuentasclaras.app

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.viewModels
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ReceiptLong
import androidx.compose.material.icons.filled.AccountBalanceWallet
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.PieChart
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material3.Icon
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.NavigationBarItemDefaults
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import androidx.navigation.navArgument
import es.cuentasclaras.app.ui.AccountsScreen
import es.cuentasclaras.app.ui.BudgetsScreen
import es.cuentasclaras.app.ui.CCTheme
import es.cuentasclaras.app.ui.EditorScreen
import es.cuentasclaras.app.ui.HomeScreen
import es.cuentasclaras.app.ui.MovementsScreen
import es.cuentasclaras.app.ui.Pal
import es.cuentasclaras.app.ui.SettingsScreen

class MainActivity : ComponentActivity() {
    private val vm: AppViewModel by viewModels()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent { CCTheme { AppRoot(vm) } }
    }
}

private data class Tab(val route: String, val label: String, val icon: ImageVector)

private val tabs = listOf(
    Tab("inicio", "Inicio", Icons.Filled.Home),
    Tab("movimientos", "Movimientos", Icons.AutoMirrored.Filled.ReceiptLong),
    Tab("presupuestos", "Presupuestos", Icons.Filled.PieChart),
    Tab("cuentas", "Cuentas", Icons.Filled.AccountBalanceWallet),
    Tab("ajustes", "Ajustes", Icons.Filled.Settings),
)

@Composable
fun AppRoot(vm: AppViewModel) {
    val nav = rememberNavController()
    val entry by nav.currentBackStackEntryAsState()
    val route = entry?.destination?.route
    Scaffold(
        containerColor = Pal.bg,
        bottomBar = {
            if (route?.startsWith("editor") != true) NavigationBar(containerColor = Pal.panel) {
                tabs.forEach { t ->
                    NavigationBarItem(
                        selected = route == t.route,
                        onClick = { nav.navigate(t.route) { popUpTo("inicio"); launchSingleTop = true } },
                        icon = { Icon(t.icon, contentDescription = null) },
                        label = { Text(t.label, maxLines = 1) },
                        colors = NavigationBarItemDefaults.colors(selectedIconColor = Pal.accent, selectedTextColor = Pal.accent, indicatorColor = Pal.raise, unselectedIconColor = Pal.muted, unselectedTextColor = Pal.muted),
                    )
                }
            }
        },
    ) { pad ->
        NavHost(nav, startDestination = "inicio", modifier = Modifier.padding(pad)) {
            composable("inicio") { HomeScreen(vm, onAdd = { nav.navigate("editor") }, onOpen = { nav.navigate("editor?id=$it") }) }
            composable("movimientos") { MovementsScreen(vm, onAdd = { nav.navigate("editor") }, onOpen = { nav.navigate("editor?id=$it") }) }
            composable("presupuestos") { BudgetsScreen(vm) }
            composable("cuentas") { AccountsScreen(vm) }
            composable("ajustes") { SettingsScreen(vm) }
            composable("editor?id={id}", arguments = listOf(navArgument("id") { type = NavType.StringType; nullable = true; defaultValue = null })) {
                EditorScreen(vm, it.arguments?.getString("id"), onDone = { nav.popBackStack() })
            }
        }
    }
}
