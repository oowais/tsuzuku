package com.owaisahmed.tsuzuku

import android.os.Handler
import android.os.Looper
import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel

/**
 * The in-app update channel `tsuzuku/updater` (#108, step 3.3; Dart side in
 * lib/update/installers.dart). `install(url)` downloads the APK and starts the
 * system installer (Updater.kt); without "Install unknown apps" it opens that
 * setting instead and answers `{ needsPermission: true }`. Sends `progress`
 * `{ done, total }` while downloading (`total` -1 when unknown).
 */
class MainActivity : FlutterActivity() {
    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        val channel = MethodChannel(flutterEngine.dartExecutor.binaryMessenger, "tsuzuku/updater")
        val main = Handler(Looper.getMainLooper())
        channel.setMethodCallHandler { call, result ->
            if (call.method != "install") {
                result.notImplemented()
                return@setMethodCallHandler
            }
            val url = call.argument<String>("url")
            if (url == null) {
                result.error("args", "url missing", null)
                return@setMethodCallHandler
            }
            if (!Updater.canInstall(this)) {
                Updater.openInstallSettings(this)
                result.success(mapOf("needsPermission" to true))
                return@setMethodCallHandler
            }
            val ctx = applicationContext
            Thread {
                try {
                    Updater.downloadAndInstall(ctx, url) { done, total ->
                        main.post { channel.invokeMethod("progress", mapOf("done" to done, "total" to total)) }
                    }
                    main.post { result.success(mapOf("needsPermission" to false)) }
                } catch (e: Exception) {
                    main.post { result.error("update", e.message ?: e.toString(), null) }
                }
            }.start()
        }
    }
}
