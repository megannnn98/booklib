package io.github.megannnn98.booklib

internal object FilenameSanitizer {
    fun sanitize(name: String): String {
        if (name.isBlank()) {
            return "booklib_download_${System.currentTimeMillis()}"
        }

        var sanitized = name
            .replace("\\", "/")
            .split("/")
            .lastOrNull { it.isNotBlank() && it != ".." && it != "." }
            ?: ""

        sanitized = sanitized.filter { it.code >= 32 && it != '\u007F' }
        sanitized = sanitized.trim()

        if (sanitized.isBlank() || sanitized.all { it == '.' }) {
            return "booklib_download_${System.currentTimeMillis()}"
        }

        val maxNameLength = 200
        if (sanitized.length > maxNameLength) {
            val extension = sanitized.substringAfterLast('.', "")
            val baseName = sanitized.substringBeforeLast('.')
            val truncatedBase = baseName.take(maxNameLength - extension.length - 1)
            sanitized = if (extension.isNotEmpty()) "$truncatedBase.$extension" else truncatedBase
        }

        return sanitized
    }
}
