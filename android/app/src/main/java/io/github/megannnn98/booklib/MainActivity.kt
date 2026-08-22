package io.github.megannnn98.booklib

import android.annotation.SuppressLint
import android.content.ActivityNotFoundException
import android.content.Intent
import android.graphics.Color
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.view.View
import android.webkit.CookieManager
import android.webkit.SslErrorHandler
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.FrameLayout
import android.widget.ProgressBar
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat

class MainActivity : AppCompatActivity() {

    private lateinit var webView: WebView
    private lateinit var progressBar: ProgressBar
    private lateinit var errorLayout: FrameLayout
    private lateinit var errorText: TextView
    private lateinit var retryButton: Button

    private lateinit var downloadOverlay: FrameLayout
    private lateinit var downloadTitle: TextView
    private lateinit var downloadFilename: TextView
    private lateinit var downloadProgress: ProgressBar
    private lateinit var downloadStatus: TextView

    private var fileDownloader: FileDownloader? = null
    private var pendingDownload: Triple<String, String, Pair<String?, String>>? = null

    private val baseUrl = "https://archlinux.local/"
    private val navigationPolicy = NavigationPolicy()

    companion object {
        private const val REQUEST_STORAGE_PERMISSION = 1001
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        setupEdgeToEdge()
        setContentView(R.layout.activity_main)

        webView = findViewById(R.id.webView)
        progressBar = findViewById(R.id.progressBar)
        errorLayout = findViewById(R.id.errorLayout)
        errorText = findViewById(R.id.errorText)
        retryButton = findViewById(R.id.retryButton)

        downloadOverlay = findViewById(R.id.downloadOverlay)
        downloadTitle = findViewById(R.id.downloadTitle)
        downloadFilename = findViewById(R.id.downloadFilename)
        downloadProgress = findViewById(R.id.downloadProgress)
        downloadStatus = findViewById(R.id.downloadStatus)

        setupWebView()

        retryButton.setOnClickListener {
            errorLayout.visibility = View.GONE
            webView.visibility = View.VISIBLE
            progressBar.visibility = View.VISIBLE
            webView.loadUrl(baseUrl)
        }

        if (savedInstanceState == null) {
            webView.loadUrl(baseUrl)
        }
    }

    private fun setupEdgeToEdge() {
        WindowCompat.setDecorFitsSystemWindows(window, false)
        window.statusBarColor = Color.TRANSPARENT
        window.navigationBarColor = Color.TRANSPARENT
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun setupWebView() {
        webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            cacheMode = android.webkit.WebSettings.LOAD_DEFAULT
            allowFileAccess = false
            allowContentAccess = false
            builtInZoomControls = false
            displayZoomControls = false
            setSupportZoom(false)
            loadWithOverviewMode = true
            useWideViewPort = true
            mediaPlaybackRequiresUserGesture = true
            mixedContentMode = android.webkit.WebSettings.MIXED_CONTENT_NEVER_ALLOW
            safeBrowsingEnabled = true
        }

        webView.setBackgroundColor(Color.parseColor("#14161a"))

        webView.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(
                view: WebView,
                request: WebResourceRequest
            ): Boolean {
                val url = request.url.toString()
                return when (val decision = navigationPolicy.decide(url)) {
                    is NavigationDecision.Internal -> false
                    is NavigationDecision.ExternalBrowser -> {
                        openInBrowser(decision.url)
                        true
                    }
                    is NavigationDecision.Reject -> {
                        Toast.makeText(this@MainActivity,
                            "Заблокировано: ${decision.reason}",
                            Toast.LENGTH_SHORT).show()
                        true
                    }
                }
            }

            override fun onReceivedSslError(
                view: WebView,
                handler: SslErrorHandler,
                error: android.net.http.SslError
            ) {
                handler.cancel()
                view.stopLoading()
                view.clearHistory()
                showTlsError()
            }

            override fun onReceivedError(
                view: WebView,
                request: WebResourceRequest,
                error: WebResourceError
            ) {
                if (request.isForMainFrame) {
                    showNetworkError()
                }
            }

            override fun onPageStarted(view: WebView, url: String, favicon: android.graphics.Bitmap?) {
                super.onPageStarted(view, url, favicon)
                progressBar.visibility = View.VISIBLE
            }

            override fun onPageFinished(view: WebView, url: String) {
                super.onPageFinished(view, url)
                progressBar.visibility = View.GONE
            }
        }

        webView.setDownloadListener { url, userAgent, contentDisposition, mimetype, _ ->
            downloadFile(url, userAgent, contentDisposition, mimetype)
        }

        ViewCompat.setOnApplyWindowInsetsListener(webView) { view, insets ->
            view.setPadding(0, 0, 0, 0)
            insets
        }
    }

    private fun openInBrowser(url: String) {
        try {
            val intent = Intent(Intent.ACTION_VIEW, Uri.parse(url))
            if (intent.resolveActivity(packageManager) != null) {
                startActivity(intent)
            } else {
                Toast.makeText(this, "Не найден браузер для открытия ссылки", Toast.LENGTH_SHORT).show()
            }
        } catch (e: ActivityNotFoundException) {
            Toast.makeText(this, "Не удалось открыть ссылку", Toast.LENGTH_SHORT).show()
        }
    }

    private fun showNetworkError() {
        webView.visibility = View.GONE
        progressBar.visibility = View.GONE
        errorLayout.visibility = View.VISIBLE
        errorText.text = "Сервер Booklib недоступен\n\n$baseUrl"
    }

    private fun showTlsError() {
        webView.visibility = View.GONE
        progressBar.visibility = View.GONE
        errorLayout.visibility = View.VISIBLE
        errorText.text = "Ошибка сертификата Booklib\n\n" +
                "Сертификат сервера не прошёл проверку.\n" +
                "Проверьте, что CA-сертификат установлен в Android."
    }

    private fun downloadFile(
        url: String,
        userAgent: String,
        contentDisposition: String?,
        mimetype: String
    ) {
        val decision = navigationPolicy.decide(url)
        if (decision !is NavigationDecision.Internal) {
            Toast.makeText(this, "Скачивание разрешено только с archlinux.local", Toast.LENGTH_SHORT).show()
            return
        }

        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
            if (checkSelfPermission(android.Manifest.permission.WRITE_EXTERNAL_STORAGE)
                != android.content.pm.PackageManager.PERMISSION_GRANTED) {
                requestPermissions(
                    arrayOf(android.Manifest.permission.WRITE_EXTERNAL_STORAGE),
                    REQUEST_STORAGE_PERMISSION
                )
                pendingDownload = Triple(url, userAgent, contentDisposition to mimetype)
                return
            }
        }

        startDownload(url, userAgent, contentDisposition, mimetype)
    }

    private fun startDownload(
        url: String,
        userAgent: String,
        contentDisposition: String?,
        mimetype: String
    ) {
        fileDownloader?.cancel()

        val downloader = FileDownloader(this)
        fileDownloader = downloader

        showDownloadOverlay("Подготовка...")

        downloader.download(
            url = url,
            userAgent = userAgent,
            contentDisposition = contentDisposition,
            mimeType = mimetype,
            listener = object : FileDownloader.DownloadListener {
                override fun onProgress(filename: String, bytesDownloaded: Long, totalBytes: Long?) {
                    updateDownloadProgress(filename, bytesDownloaded, totalBytes)
                }

                override fun onComplete(filename: String, uri: Uri?) {
                    hideDownloadOverlay()
                    Toast.makeText(
                        this@MainActivity,
                        "Сохранено: $filename",
                        Toast.LENGTH_LONG
                    ).show()
                    fileDownloader = null
                }

                override fun onError(filename: String, error: String) {
                    hideDownloadOverlay()
                    Toast.makeText(
                        this@MainActivity,
                        "Ошибка загрузки: $error",
                        Toast.LENGTH_LONG
                    ).show()
                    fileDownloader = null
                }
            }
        )
    }

    override fun onRequestPermissionsResult(
        requestCode: Int,
        permissions: Array<out String>,
        grantResults: IntArray
    ) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == REQUEST_STORAGE_PERMISSION) {
            if (grantResults.isNotEmpty() && grantResults[0] == android.content.pm.PackageManager.PERMISSION_GRANTED) {
                pendingDownload?.let { (url, userAgent, extra) ->
                    startDownload(url, userAgent, extra.first, extra.second)
                    pendingDownload = null
                }
            } else {
                Toast.makeText(
                    this,
                    "Для сохранения файлов требуется разрешение на запись",
                    Toast.LENGTH_LONG
                ).show()
            }
        }
    }

    private fun showDownloadOverlay(status: String) {
        downloadOverlay.visibility = View.VISIBLE
        downloadStatus.text = status
        downloadProgress.isIndeterminate = true
    }

    private fun updateDownloadProgress(filename: String, bytesDownloaded: Long, totalBytes: Long?) {
        downloadFilename.text = filename

        if (totalBytes != null && totalBytes > 0) {
            downloadProgress.isIndeterminate = false
            downloadProgress.max = 100
            val percent = ((bytesDownloaded * 100) / totalBytes).toInt()
            downloadProgress.progress = percent

            val downloadedMb = bytesDownloaded / (1024.0 * 1024.0)
            val totalMb = totalBytes / (1024.0 * 1024.0)
            downloadStatus.text = String.format("%.1f / %.1f МБ (%d%%)", downloadedMb, totalMb, percent)
        } else {
            downloadProgress.isIndeterminate = true
            val downloadedMb = bytesDownloaded / (1024.0 * 1024.0)
            downloadStatus.text = String.format("%.1f МБ", downloadedMb)
        }
    }

    private fun hideDownloadOverlay() {
        downloadOverlay.visibility = View.GONE
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        webView.saveState(outState)
    }

    override fun onRestoreInstanceState(savedInstanceState: Bundle) {
        super.onRestoreInstanceState(savedInstanceState)
        webView.restoreState(savedInstanceState)
    }

    @Deprecated("Deprecated in Java")
    override fun onBackPressed() {
        if (webView.canGoBack()) {
            webView.goBack()
        } else {
            @Suppress("DEPRECATION")
            super.onBackPressed()
        }
    }

    override fun onPause() {
        super.onPause()
        webView.onPause()
    }

    override fun onResume() {
        super.onResume()
        webView.onResume()
    }

    override fun onDestroy() {
        fileDownloader?.cancel()
        webView.destroy()
        super.onDestroy()
    }
}
