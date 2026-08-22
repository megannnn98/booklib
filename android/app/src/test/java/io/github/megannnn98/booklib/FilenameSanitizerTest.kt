package io.github.megannnn98.booklib

import org.junit.Assert.*
import org.junit.Test

class FilenameSanitizerTest {

    @Test
    fun `simple filename unchanged`() {
        val result = FilenameSanitizer.sanitize("Книга.pdf")
        assertEquals("Книга.pdf", result)
    }

    @Test
    fun `filename with path - extract basename`() {
        val result = FilenameSanitizer.sanitize("../../secret.pdf")
        assertEquals("secret.pdf", result)
    }

    @Test
    fun `filename with backslash path - extract basename`() {
        val result = FilenameSanitizer.sanitize("..\\secret.pdf")
        assertEquals("secret.pdf", result)
    }

    @Test
    fun `filename with control characters - remove them`() {
        val result = FilenameSanitizer.sanitize("test\u0000\u0001\u0002file.pdf")
        assertEquals("testfile.pdf", result)
    }

    @Test
    fun `empty filename - fallback`() {
        val result = FilenameSanitizer.sanitize("")
        assertTrue(result.startsWith("booklib_download_"))
    }

    @Test
    fun `blank filename - fallback`() {
        val result = FilenameSanitizer.sanitize("   ")
        assertTrue(result.startsWith("booklib_download_"))
    }

    @Test
    fun `filename with leading and trailing spaces - trim`() {
        val result = FilenameSanitizer.sanitize("  test.pdf  ")
        assertEquals("test.pdf", result)
    }

    @Test
    fun `very long filename - truncate preserving extension`() {
        val longName = "a".repeat(300) + ".pdf"
        val result = FilenameSanitizer.sanitize(longName)
        assertTrue(result.length <= 200)
        assertTrue(result.endsWith(".pdf"))
    }

    @Test
    fun `filename with only dots - fallback`() {
        val result = FilenameSanitizer.sanitize("...")
        assertTrue(result.startsWith("booklib_download_"))
    }

    @Test
    fun `filename with traversal and valid name - extract valid`() {
        val result = FilenameSanitizer.sanitize("../../etc/passwd")
        assertEquals("passwd", result)
    }

    @Test
    fun `filename with mixed path separators - extract basename`() {
        val result = FilenameSanitizer.sanitize("path/to\\file.txt")
        assertEquals("file.txt", result)
    }

    @Test
    fun `filename without extension - keep as is`() {
        val result = FilenameSanitizer.sanitize("README")
        assertEquals("README", result)
    }

    @Test
    fun `filename with multiple dots - keep all`() {
        val result = FilenameSanitizer.sanitize("archive.tar.gz")
        assertEquals("archive.tar.gz", result)
    }
}
