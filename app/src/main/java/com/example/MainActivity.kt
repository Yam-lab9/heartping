package com.example

import android.annotation.SuppressLint
import android.content.Context
import android.os.Build
import android.os.Bundle
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import android.webkit.JavascriptInterface
import android.webkit.WebChromeClient
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.net.Uri
import androidx.webkit.WebViewAssetLoader
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.remember
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.viewinterop.AndroidView
import com.example.ui.theme.MyApplicationTheme

class MainActivity : ComponentActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    enableEdgeToEdge()
    setContent {
      MyApplicationTheme {
        Surface(
          modifier = Modifier.fillMaxSize(),
          color = Color(0xFFFFF5F7)
        ) {
          HeartPingScreen()
        }
      }
    }
  }
}

class AndroidBridge(private val context: Context) {
  @JavascriptInterface
  fun vibrate(durationMs: Long) {
    try {
      val ms = durationMs.coerceIn(10L, 500L)
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
        val vibratorManager =
          context.getSystemService(Context.VIBRATOR_MANAGER_SERVICE) as? VibratorManager
        vibratorManager?.defaultVibrator?.vibrate(
          VibrationEffect.createOneShot(ms, VibrationEffect.DEFAULT_AMPLITUDE)
        )
      } else {
        @Suppress("DEPRECATION")
        val vibrator = context.getSystemService(Context.VIBRATOR_SERVICE) as? Vibrator
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
          vibrator?.vibrate(
            VibrationEffect.createOneShot(ms, VibrationEffect.DEFAULT_AMPLITUDE)
          )
        } else {
          @Suppress("DEPRECATION")
          vibrator?.vibrate(ms)
        }
      }
    } catch (e: Exception) {
      e.printStackTrace()
    }
  }

  @JavascriptInterface
  fun isNative(): Boolean {
    return true
  }
}

@SuppressLint("SetJavaScriptEnabled")
@Composable
fun HeartPingScreen(modifier: Modifier = Modifier) {
  val context = androidx.compose.ui.platform.LocalContext.current
  val lifecycleOwner = LocalLifecycleOwner.current
  val webView = remember {
    val assetLoader = WebViewAssetLoader.Builder()
      .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(context))
      .build()
    val startUrl = BuildConfig.HEARTPING_URL.ifBlank {
      "https://appassets.androidplatform.net/assets/www/index.html"
    }
    val allowed = Uri.parse(startUrl)
    WebView(context).apply {
      settings.javaScriptEnabled = true
      settings.domStorageEnabled = true
      settings.allowFileAccess = false
      settings.allowContentAccess = false
      settings.mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
      settings.mediaPlaybackRequiresUserGesture = true
      webViewClient = object : WebViewClient() {
        override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? =
          assetLoader.shouldInterceptRequest(request.url)
        override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean =
          request.url.scheme != "https" || request.url.host != allowed.host || request.url.port != allowed.port
      }
      webChromeClient = WebChromeClient()
      // Expose the bounded vibration bridge only to bundled content.
      if (BuildConfig.HEARTPING_URL.isBlank()) addJavascriptInterface(AndroidBridge(context), "AndroidBridge")
      loadUrl(startUrl)
    }
  }
  DisposableEffect(lifecycleOwner, webView) {
    val observer = LifecycleEventObserver { _, event ->
      when (event) {
        Lifecycle.Event.ON_PAUSE -> webView.onPause()
        Lifecycle.Event.ON_RESUME -> webView.onResume()
        else -> Unit
      }
    }
    lifecycleOwner.lifecycle.addObserver(observer)
    onDispose {
      lifecycleOwner.lifecycle.removeObserver(observer)
      webView.stopLoading()
      webView.removeJavascriptInterface("AndroidBridge")
      webView.destroy()
    }
  }
  AndroidView(modifier = modifier.fillMaxSize().safeDrawingPadding(), factory = { webView })
}

@Composable
fun Greeting(name: String, modifier: Modifier = Modifier) {
  Text(text = "Hello $name!", modifier = modifier)
}

