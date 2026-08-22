package io.github.megannnn98.booklib

import java.net.URI

sealed class NavigationDecision {
    data object Internal : NavigationDecision()
    data class ExternalBrowser(val url: String) : NavigationDecision()
    data class Reject(val reason: String) : NavigationDecision()
}

class NavigationPolicy(
    private val allowedHost: String = "archlinux.local",
    private val allowedScheme: String = "https"
) {
    fun decide(urlString: String): NavigationDecision {
        val uri = try {
            URI(urlString)
        } catch (e: Exception) {
            return NavigationDecision.Reject("Invalid URL: ${e.message}")
        }

        val scheme = uri.scheme?.lowercase()

        if (scheme == null) {
            return NavigationDecision.Reject("Missing scheme")
        }

        if (isInternalUrl(uri)) {
            return NavigationDecision.Internal
        }

        if (scheme == "http" || scheme == "https") {
            return NavigationDecision.ExternalBrowser(urlString)
        }

        return NavigationDecision.Reject("Blocked scheme: $scheme")
    }

    private fun isInternalUrl(uri: URI): Boolean {
        val scheme = uri.scheme?.lowercase() ?: return false
        val host = uri.host?.lowercase()?.removeSuffix(".") ?: return false
        val port = uri.port

        if (scheme != allowedScheme) {
            return false
        }

        if (host != allowedHost.lowercase()) {
            return false
        }

        if (port != -1 && port != 443) {
            return false
        }

        return true
    }
}
