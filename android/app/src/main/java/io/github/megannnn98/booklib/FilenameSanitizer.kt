package io.github.megannnn98.booklib

internal object FilenameSanitizer {
    private val reservedChars = setOf(':', '*', '?', '<', '>', '|', '"')

    fun sanitize(name: String): String {
        if (name.isBlank()) {
            return "booklib_download_${System.currentTimeMillis()}"
        }

        var sanitized = name
            .replace("\\", "/")
            .split("/")
            .lastOrNull { it.isNotBlank() && it != ".." && it != "." }
            ?: ""

        sanitized = sanitized.filter { it.code >= 32 && it != '\u007F' && it !in reservedChars }
        sanitized = sanitized.trim()

        if (sanitized.isBlank() || sanitized.all { it == '.' }) {
            return "booklib_download_${System.currentTimeMillis()}"
        }

        val maxNameLength = 200
        val maxExtensionLength = 20
        if (sanitized.length > maxNameLength) {
            val extension = sanitized.substringAfterLast('.', "")
            val baseName = sanitized.substringBeforeLast('.')

            val safeExtension = if (extension.length > maxExtensionLength) {
                extension.take(maxExtensionLength)
            } else {
                extension
            }

            val availableForBase = maxNameLength - safeExtension.length - 1
            val truncatedBase = if (availableForBase > 0) {
                baseName.take(availableForBase)
            } else {
                baseName.take(maxNameLength)
            }

            sanitized = if (safeExtension.isNotEmpty()) {
                "$truncatedBase.$safeExtension"
            } else {
                truncatedBase
            }
        }

        return sanitized
    }
}
