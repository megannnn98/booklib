package io.github.megannnn98.booklib

import java.net.URL
import java.net.URLDecoder

object ContentDispositionParser {

    fun parseFilename(contentDisposition: String?, url: String, mimeType: String? = null): String {
        if (!contentDisposition.isNullOrEmpty()) {
            val filenameStar = Regex("filename\\*=([^']*)'([^']*)'([^;]+)", RegexOption.IGNORE_CASE)
                .find(contentDisposition)
            if (filenameStar != null) {
                val charset = filenameStar.groupValues[1]
                val encodedValue = filenameStar.groupValues[3].trim()

                if (charset.isEmpty() || charset.equals("UTF-8", ignoreCase = true)) {
                    return try {
                        val decoded = encodedValue.replace("+", "%2B")
                        URLDecoder.decode(decoded, "UTF-8")
                    } catch (e: Exception) {
                        encodedValue
                    }
                }
            }

            val filename = Regex("filename=\"?([^\";]+)\"?", RegexOption.IGNORE_CASE)
                .find(contentDisposition)?.groupValues?.get(1)?.trim()
            if (!filename.isNullOrEmpty()) {
                return filename
            }
        }

        try {
            val urlObj = URL(url)
            val urlPath = urlObj.path
            val lastSegment = urlPath.substringAfterLast('/')
            if (lastSegment.isNotEmpty() && lastSegment.contains('.')) {
                return lastSegment
            }

            val query = urlObj.query
            if (!query.isNullOrEmpty()) {
                val fileParam = query.split('&')
                    .map { it.split('=', limit = 2) }
                    .firstOrNull { it[0] == "file" && it.size > 1 }
                    ?.get(1)
                if (!fileParam.isNullOrEmpty() && fileParam.contains('.')) {
                    return fileParam.substringAfterLast('/')
                }
            }
        } catch (e: Exception) {
        }

        val extension = when {
            mimeType == null -> ".download"
            mimeType.contains("pdf") -> ".pdf"
            mimeType.contains("epub") -> ".epub"
            mimeType.contains("fb2") || mimeType.contains("fictionbook") -> ".fb2"
            mimeType.contains("djvu") -> ".djvu"
            else -> ".download"
        }
        return "booklib_file$extension"
    }
}
