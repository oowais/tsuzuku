package com.owaisahmed.tsuzuku

import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInstaller
import android.net.Uri
import android.os.Build
import android.provider.Settings
import android.util.Log
import java.io.File
import java.net.HttpURLConnection
import java.net.URL

/**
 * Ported from Befikr (plugins/tauri-plugin-reminders/android/.../Updater.kt; #108, step 3.3).
 * In-app update: downloads the release APK and hands it to the system
 * installer, which asks the user to confirm. Android only installs it over
 * this app when it carries the same signing key.
 */
object Updater {
    private const val TAG = "TsuzukuUpdater"

    /** Whether Tsuzuku may install APKs ("Install unknown apps"; a global setting before Android 8). */
    fun canInstall(ctx: Context): Boolean =
        Build.VERSION.SDK_INT < Build.VERSION_CODES.O || ctx.packageManager.canRequestPackageInstalls()

    fun openInstallSettings(ctx: Context) {
        ctx.startActivity(
            Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:${ctx.packageName}"))
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        )
    }

    /**
     * Blocking: download `url`, then start the install session. `onProgress`
     * gets bytes done and total (-1 when the server doesn't say), at most
     * once per percent (per MB when the total is unknown).
     */
    fun downloadAndInstall(ctx: Context, url: String, onProgress: (Long, Long) -> Unit) {
        val apk = File(ctx.cacheDir, "update.apk")
        download(url, apk, onProgress)
        try {
            install(ctx, apk)
        } finally {
            apk.delete()
        }
    }

    /** Follows redirects across hosts (GitHub → its download host), https only. */
    private fun download(url: String, to: File, onProgress: (Long, Long) -> Unit) {
        var next = URL(url)
        repeat(5) {
            require(next.protocol == "https") { "update URL must be https" }
            val conn = next.openConnection() as HttpURLConnection
            conn.instanceFollowRedirects = false
            conn.connectTimeout = 15_000
            conn.readTimeout = 30_000
            try {
                when (val code = conn.responseCode) {
                    in 300..399 -> next = URL(next, conn.getHeaderField("Location"))
                    200 -> {
                        val total = conn.contentLengthLong
                        conn.inputStream.use { input ->
                            to.outputStream().use { out ->
                                val buf = ByteArray(64 * 1024)
                                var done = 0L
                                var last = -1L
                                while (true) {
                                    val n = input.read(buf)
                                    if (n < 0) break
                                    out.write(buf, 0, n)
                                    done += n
                                    val step = if (total > 0) done * 100 / total else done shr 20
                                    if (step != last) {
                                        last = step
                                        onProgress(done, total)
                                    }
                                }
                            }
                        }
                        return
                    }
                    else -> error("download failed: HTTP $code")
                }
            } finally {
                conn.disconnect()
            }
        }
        error("download failed: too many redirects")
    }

    private fun install(ctx: Context, apk: File) {
        val installer = ctx.packageManager.packageInstaller
        val params = PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL)
        params.setAppPackageName(ctx.packageName)
        val id = installer.createSession(params)
        installer.openSession(id).use { session ->
            session.openWrite("tsuzuku.apk", 0, apk.length()).use { out ->
                apk.inputStream().use { it.copyTo(out) }
                session.fsync(out)
            }
            val flags = PendingIntent.FLAG_UPDATE_CURRENT or
                (if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) PendingIntent.FLAG_MUTABLE else 0)
            val status = PendingIntent.getBroadcast(ctx, 4301, Intent(ctx, UpdateReceiver::class.java), flags)
            session.commit(status.intentSender)
        }
        Log.i(TAG, "install session $id committed")
    }
}

/** Install session results: shows the system's confirm screen when asked. */
class UpdateReceiver : BroadcastReceiver() {
    override fun onReceive(ctx: Context, intent: Intent) {
        when (val status = intent.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE)) {
            PackageInstaller.STATUS_PENDING_USER_ACTION -> {
                @Suppress("DEPRECATION")
                val confirm = intent.getParcelableExtra<Intent>(Intent.EXTRA_INTENT) ?: return
                ctx.startActivity(confirm.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
            }
            PackageInstaller.STATUS_SUCCESS -> Unit
            else -> Log.w("TsuzukuUpdater", "install failed ($status): ${intent.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE)}")
        }
    }
}
