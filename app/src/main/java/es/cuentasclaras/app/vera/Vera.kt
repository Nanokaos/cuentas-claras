package es.cuentasclaras.app.vera

import android.annotation.SuppressLint
import android.webkit.JavascriptInterface
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.viewinterop.AndroidView
import androidx.webkit.WebViewAssetLoader
import kotlinx.coroutines.flow.Flow
import org.json.JSONArray
import org.json.JSONObject

sealed interface VeraCommand {
    data class Speak(val text: String, val mood: String = "neutral", val state: String = "habla", val actions: List<Pair<String, String>> = emptyList()) : VeraCommand
    data class State(val state: String) : VeraCommand
    data class Gesture(val name: String) : VeraCommand
    data class Show(val text: String) : VeraCommand
    data class Config(val sarcasm: Int, val reduceMotion: Boolean, val quality: String, val remarks: List<String>) : VeraCommand
    data object Hide : VeraCommand
}

/**
 * Escena 3D de Vera (Three.js empaquetado en assets, sin red). La app le habla con `window.vera.*`;
 * ella avisa de toques y botones mediante `AndroidVera`.
 */
@SuppressLint("SetJavaScriptEnabled")
@Composable
fun VeraView(
    commands: Flow<VeraCommand>,
    onReady: () -> Unit,
    onTap: () -> Unit,
    onAction: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    val context = LocalContext.current
    val web = remember {
        val loader = WebViewAssetLoader.Builder().addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(context)).build()
        WebView(context).apply {
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.mediaPlaybackRequiresUserGesture = false
            setBackgroundColor(0xFF07050D.toInt())
            isVerticalScrollBarEnabled = false
            webViewClient = object : WebViewClient() {
                override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? =
                    loader.shouldInterceptRequest(request.url)
                override fun onPageFinished(view: WebView, url: String) { onReady() }
            }
            addJavascriptInterface(object {
                @JavascriptInterface fun onPoke() {}
                @JavascriptInterface fun onTap() { post { onTap() } }
                @JavascriptInterface fun onAction(id: String) { post { onAction(id) } }
            }, "AndroidVera")
            loadUrl("https://appassets.androidplatform.net/assets/vera/index.html")
        }
    }
    LaunchedEffect(web) {
        commands.collect { cmd -> web.evaluateJavascript(cmd.toJs(), null) }
    }
    AndroidView(factory = { web }, modifier = modifier)
}

private fun q(s: String) = JSONObject.quote(s)

private fun VeraCommand.toJs(): String = "window.vera && " + when (this) {
    is VeraCommand.Speak -> {
        val acts = if (actions.isEmpty()) "null" else JSONArray(actions.map { JSONObject().put("label", it.first).put("id", it.second) }).toString()
        "vera.speak(${q(text)}, ${q(mood)}, ${q(state)}, $acts)"
    }
    is VeraCommand.State -> "vera.setState(${q(state)})"
    is VeraCommand.Gesture -> "vera.gesture(${q(name)})"
    is VeraCommand.Show -> "vera.show(${q(text)})"
    VeraCommand.Hide -> "vera.hide()"
    is VeraCommand.Config -> "(vera.setSarcasm($sarcasm), vera.setReduceMotion($reduceMotion), vera.setQuality(${q(quality)}), vera.setRemarks(${JSONArray(remarks)}))"
}
