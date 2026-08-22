package io.github.megannnn98.booklib

import android.content.ContentValues
import android.content.Context
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import android.webkit.CookieManager
import androidx.annotation.RequiresApi
import kotlinx.coroutines.*
import java.io.File
import java.io.InputStream
import java.net.HttpURLConnection
import java.net.URL

class FileDownloader(private val context: Context) {

    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())

    @Volatile
    private var activeConnection: HttpURLConnection? = null

    interface DownloadListener {
        fun onProgress(filename: String, bytesDownloaded: Long, totalBytes: Long?)
        fun onComplete(filename: String, uri: Uri?)
        fun onError(filename: String, error: String)
    }

    fun download(
        url: String,
        userAgent: String,
        contentDisposition: String?,
        mimeType: String?,
        listener: DownloadListener
    ) {
        scope.launch {
            var inputStream: InputStream? = null
            var filename = FilenameSanitizer.sanitize(
                ContentDispositionParser.parseFilename(contentDisposition, url, mimeType ?: "")
            )

            try {
                notifyListener(listener, filename, 0, null, null, null)

                val connection = createConnection(url, userAgent)
                activeConnection = connection
                connection.connect()

                val responseCode = connection.responseCode
                if (responseCode !in 200..299) {
                    if (responseCode in 300..399) {
                        throw Exception("Редирект не поддерживается (HTTP $responseCode)")
                    }
                    throw Exception("HTTP ошибка $responseCode")
                }

                val responseContentLength = connection.contentLengthLong.takeIf { it > 0 }
                val responseContentType = connection.contentType
                val responseContentDisposition = connection.getHeaderField("Content-Disposition")

                val effectiveFilename = ContentDispositionParser.parseFilename(
                    responseContentDisposition ?: contentDisposition,
                    url,
                    responseContentType ?: mimeType ?: ""
                )
                filename = FilenameSanitizer.sanitize(effectiveFilename)

                val effectiveMimeType = responseContentType ?: mimeType ?: "application/octet-stream"

                inputStream = connection.inputStream

                val uri = saveFile(inputStream, filename, effectiveMimeType, responseContentLength, listener)

                notifyListener(listener, filename, null, null, uri, null)

            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                notifyListener(listener, filename, null, null, null, e.message ?: "Неизвестная ошибка")
            } finally {
                inputStream?.close()
                activeConnection?.disconnect()
                activeConnection = null
            }
        }
    }

    private suspend fun notifyListener(
        listener: DownloadListener,
        filename: String,
        bytesDownloaded: Long?,
        totalBytes: Long?,
        uri: Uri?,
        error: String?
    ) = withContext(Dispatchers.Main) {
        when {
            error != null -> listener.onError(filename, error)
            uri != null -> listener.onComplete(filename, uri)
            else -> listener.onProgress(filename, bytesDownloaded ?: 0, totalBytes)
        }
    }

    private fun createConnection(urlString: String, userAgent: String): HttpURLConnection {
        val url = URL(urlString)
        val connection = url.openConnection() as HttpURLConnection

        connection.apply {
            requestMethod = "GET"
            connectTimeout = 30000
            readTimeout = 60000
            setRequestProperty("User-Agent", userAgent)

            val cookies = CookieManager.getInstance().getCookie(urlString)
            if (!cookies.isNullOrEmpty()) {
                setRequestProperty("Cookie", cookies)
            }

            instanceFollowRedirects = false
            useCaches = false
        }

        return connection
    }

    private suspend fun saveFile(
        inputStream: InputStream,
        filename: String,
        mimeType: String,
        contentLength: Long?,
        listener: DownloadListener
    ): Uri? = withContext(Dispatchers.IO) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            saveWithMediaStore(filename, mimeType, inputStream, contentLength, listener)
        } else {
            saveWithLegacyStorage(filename, inputStream, contentLength, listener)
        }
    }

    @RequiresApi(Build.VERSION_CODES.Q)
    private suspend fun saveWithMediaStore(
        filename: String,
        mimeType: String,
        inputStream: InputStream,
        contentLength: Long?,
        listener: DownloadListener
    ): Uri? {
        val contentValues = ContentValues().apply {
            put(MediaStore.Downloads.DISPLAY_NAME, filename)
            put(MediaStore.Downloads.MIME_TYPE, mimeType)
            put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS)
            put(MediaStore.Downloads.IS_PENDING, 1)
        }

        val resolver = context.contentResolver
        val uri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, contentValues)
            ?: throw Exception("Не удалось создать файл")

        try {
            resolver.openOutputStream(uri)?.use { outputStream ->
                val buffer = ByteArray(8192)
                var bytesRead: Int
                var totalBytesRead = 0L

                while (inputStream.read(buffer).also { bytesRead = it } != -1) {
                    outputStream.write(buffer, 0, bytesRead)
                    totalBytesRead += bytesRead

                    notifyListener(listener, filename, totalBytesRead, contentLength, null, null)
                }
                outputStream.flush()

                if (contentLength != null && totalBytesRead != contentLength) {
                    throw Exception("Неполная загрузка: ожидалось $contentLength байт, получено $totalBytesRead")
                }
            } ?: throw Exception("Не удалось открыть поток записи")

            contentValues.clear()
            contentValues.put(MediaStore.Downloads.IS_PENDING, 0)
            resolver.update(uri, contentValues, null, null)

            return uri

        } catch (e: Exception) {
            try {
                resolver.delete(uri, null, null)
            } catch (_: Exception) {}
            throw e
        }
    }

    private suspend fun saveWithLegacyStorage(
        filename: String,
        inputStream: InputStream,
        contentLength: Long?,
        listener: DownloadListener
    ): Uri? {
        val downloadsDir = Environment.getExternalStoragePublicDirectory(
            Environment.DIRECTORY_DOWNLOADS
        )

        if (!downloadsDir.exists()) {
            downloadsDir.mkdirs()
        }

        var finalFilename = filename
        var counter = 1
        val baseName = filename.substringBeforeLast('.')
        val extension = filename.substringAfterLast('.', "")

        while (File(downloadsDir, finalFilename).exists()) {
            finalFilename = if (extension.isNotEmpty()) {
                "$baseName ($counter).$extension"
            } else {
                "$baseName ($counter)"
            }
            counter++
        }

        val file = File(downloadsDir, finalFilename)
        var tempFile: File? = null

        try {
            tempFile = File.createTempFile("download_", ".tmp", context.cacheDir)
            tempFile.outputStream().use { tempStream ->
                val buffer = ByteArray(8192)
                var bytesRead: Int
                var totalBytesRead = 0L

                while (inputStream.read(buffer).also { bytesRead = it } != -1) {
                    tempStream.write(buffer, 0, bytesRead)
                    totalBytesRead += bytesRead

                    notifyListener(listener, finalFilename, totalBytesRead, contentLength, null, null)
                }
                tempStream.flush()

                if (contentLength != null && totalBytesRead != contentLength) {
                    throw Exception("Неполная загрузка: ожидалось $contentLength байт, получено $totalBytesRead")
                }
            }

            tempFile.copyTo(file, overwrite = false)

            return Uri.fromFile(file)

        } catch (e: Exception) {
            file.delete()
            throw e
        } finally {
            tempFile?.delete()
        }
    }

    fun cancel() {
        activeConnection?.disconnect()
        scope.cancel()
    }
}
