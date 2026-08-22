package io.github.megannnn98.booklib

import org.junit.Assert.*
import org.junit.Test

class NavigationPolicyTest {

    private val policy = NavigationPolicy()

    @Test
    fun `internal URL - root path`() {
        val result = policy.decide("https://archlinux.local/")
        assertTrue("Expected Internal but got $result", result is NavigationDecision.Internal)
    }

    @Test
    fun `internal URL - API path`() {
        val result = policy.decide("https://archlinux.local/api/books")
        assertTrue("Expected Internal but got $result", result is NavigationDecision.Internal)
    }

    @Test
    fun `internal URL - with query`() {
        val result = policy.decide("https://archlinux.local/search?q=test")
        assertTrue("Expected Internal but got $result", result is NavigationDecision.Internal)
    }

    @Test
    fun `internal URL - uppercase host`() {
        val result = policy.decide("https://ARCHLINUX.LOCAL/path")
        assertTrue("Expected Internal but got $result", result is NavigationDecision.Internal)
    }

    @Test
    fun `internal URL - mixed case host`() {
        val result = policy.decide("https://ArchLinux.Local/path")
        assertTrue("Expected Internal but got $result", result is NavigationDecision.Internal)
    }

    @Test
    fun `internal URL - trailing dot host`() {
        val result = policy.decide("https://archlinux.local./path")
        assertTrue("Expected Internal but got $result", result is NavigationDecision.Internal)
    }

    @Test
    fun `external URL - different host`() {
        val result = policy.decide("https://evil.example/")
        assertTrue("Expected ExternalBrowser but got $result", result is NavigationDecision.ExternalBrowser)
    }

    @Test
    fun `external URL - subdomain attack`() {
        val result = policy.decide("https://archlinux.local.evil.example/")
        assertTrue("Expected ExternalBrowser but got $result", result is NavigationDecision.ExternalBrowser)
    }

    @Test
    fun `external URL - HTTP scheme`() {
        val result = policy.decide("http://evil.example/")
        assertTrue("Expected ExternalBrowser but got $result", result is NavigationDecision.ExternalBrowser)
    }

    @Test
    fun `external URL - HTTP archlinux local`() {
        val result = policy.decide("http://archlinux.local/path")
        assertTrue("Expected ExternalBrowser but got $result", result is NavigationDecision.ExternalBrowser)
    }

    @Test
    fun `blocked scheme - file`() {
        val result = policy.decide("file:///etc/passwd")
        assertTrue("Expected Reject but got $result", result is NavigationDecision.Reject)
    }

    @Test
    fun `blocked scheme - content`() {
        val result = policy.decide("content://example/file")
        assertTrue("Expected Reject but got $result", result is NavigationDecision.Reject)
    }

    @Test
    fun `blocked scheme - javascript`() {
        val result = policy.decide("javascript:alert(1)")
        assertTrue("Expected Reject but got $result", result is NavigationDecision.Reject)
    }

    @Test
    fun `blocked scheme - intent`() {
        val result = policy.decide("intent://example")
        assertTrue("Expected Reject but got $result", result is NavigationDecision.Reject)
    }

    @Test
    fun `blocked scheme - data`() {
        val result = policy.decide("data:text/html,<script>alert(1)</script>")
        assertTrue("Expected Reject but got $result", result is NavigationDecision.Reject)
    }

    @Test
    fun `blocked scheme - market`() {
        val result = policy.decide("market://details?id=com.example")
        assertTrue("Expected Reject but got $result", result is NavigationDecision.Reject)
    }

    @Test
    fun `blocked scheme - tel`() {
        val result = policy.decide("tel:+1234567890")
        assertTrue("Expected Reject but got $result", result is NavigationDecision.Reject)
    }

    @Test
    fun `blocked scheme - sms`() {
        val result = policy.decide("sms:+1234567890")
        assertTrue("Expected Reject but got $result", result is NavigationDecision.Reject)
    }

    @Test
    fun `blocked scheme - geo`() {
        val result = policy.decide("geo:37.7749,-122.4194")
        assertTrue("Expected Reject but got $result", result is NavigationDecision.Reject)
    }

    @Test
    fun `blocked scheme - chrome`() {
        val result = policy.decide("chrome://flags")
        assertTrue("Expected Reject but got $result", result is NavigationDecision.Reject)
    }

    @Test
    fun `blocked scheme - about`() {
        val result = policy.decide("about:blank")
        assertTrue("Expected Reject but got $result", result is NavigationDecision.Reject)
    }

    @Test
    fun `blocked scheme - blob`() {
        val result = policy.decide("blob:https://example.com/uuid")
        assertTrue("Expected Reject but got $result", result is NavigationDecision.Reject)
    }

    @Test
    fun `blocked scheme - rtsp`() {
        val result = policy.decide("rtsp://example.com/stream")
        assertTrue("Expected Reject but got $result", result is NavigationDecision.Reject)
    }

    @Test
    fun `internal URL - explicit port 443`() {
        val result = policy.decide("https://archlinux.local:443/path")
        assertTrue("Expected Internal but got $result", result is NavigationDecision.Internal)
    }

    @Test
    fun `external URL - different port`() {
        val result = policy.decide("https://archlinux.local:8080/path")
        assertTrue("Expected ExternalBrowser but got $result", result is NavigationDecision.ExternalBrowser)
    }

    @Test
    fun `external URL - userinfo in URL`() {
        val result = policy.decide("https://user:pass@archlinux.local.evil.example/")
        assertTrue("Expected ExternalBrowser but got $result", result is NavigationDecision.ExternalBrowser)
    }
}
