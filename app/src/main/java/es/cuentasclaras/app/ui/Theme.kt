package es.cuentasclaras.app.ui

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp

object Pal {
    val bg = Color(0xFF0D0A17)
    val panel = Color(0xFF141020)
    val raise = Color(0xFF1C1630)
    val line = Color(0xFF2C2444)
    val text = Color(0xFFEEE9F7)
    val muted = Color(0xFFA49CBD)
    val accent = Color(0xFFFF4FD8)
    val accent2 = Color(0xFF8C5CFF)
    val ok = Color(0xFF3DDC97)
    val warn = Color(0xFFFFB347)
    val bad = Color(0xFFFF5266)
}

private val scheme = darkColorScheme(
    primary = Pal.accent, onPrimary = Color(0xFF1A0718), secondary = Pal.accent2, onSecondary = Color.White,
    background = Pal.bg, onBackground = Pal.text, surface = Pal.panel, onSurface = Pal.text,
    surfaceVariant = Pal.raise, onSurfaceVariant = Pal.muted, outline = Pal.line, error = Pal.bad,
    surfaceContainer = Pal.panel, surfaceContainerHigh = Pal.raise, surfaceContainerHighest = Pal.raise, surfaceContainerLow = Pal.panel,
)

private val type = Typography(
    displaySmall = TextStyle(fontSize = 38.sp, fontWeight = FontWeight.SemiBold, letterSpacing = 0.sp),
    titleLarge = TextStyle(fontSize = 22.sp, fontWeight = FontWeight.SemiBold),
    titleMedium = TextStyle(fontSize = 17.sp, fontWeight = FontWeight.SemiBold),
    bodyLarge = TextStyle(fontSize = 16.sp),
    bodyMedium = TextStyle(fontSize = 14.5.sp),
    labelMedium = TextStyle(fontSize = 13.sp, color = Pal.muted),
)

@Composable
fun CCTheme(content: @Composable () -> Unit) = MaterialTheme(colorScheme = scheme, typography = type, content = content)
