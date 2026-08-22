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

    @Test
    fun `filename with very long extension - truncate extension`() {
        val longExt = "a." + "x".repeat(300)
        val result = FilenameSanitizer.sanitize(longExt)
        assertTrue("Result should not be empty", result.isNotEmpty())
        assertTrue("Result length should be <= 200, got ${result.length}", result.length <= 200)
        assertTrue("Result should contain dot", result.contains("."))
    }

    @Test
    fun `cyrillic filename with spaces - preserve`() {
        val result = FilenameSanitizer.sanitize("Моя книга (2024).pdf")
        assertEquals("Моя книга (2024).pdf", result)
    }

    @Test
    fun `cyrillic filename with special chars - preserve safe chars`() {
        val result = FilenameSanitizer.sanitize("Книга - Том 1 [издание].epub")
        assertEquals("Книга - Том 1 [издание].epub", result)
    }

    @Test
    fun `filename with unicode - preserve`() {
        val result = FilenameSanitizer.sanitize("日本語テスト.pdf")
        assertEquals("日本語テスト.pdf", result)
    }

    @Test
    fun `filename with emoji - preserve`() {
        val result = FilenameSanitizer.sanitize("Книга 📚.pdf")
        assertEquals("Книга 📚.pdf", result)
    }

    @Test
    fun `very long cyrillic filename - truncate`() {
        val longName = "Очень длинное название книги ".repeat(10) + ".pdf"
        val result = FilenameSanitizer.sanitize(longName)
        assertTrue(result.length <= 200)
        assertTrue(result.endsWith(".pdf"))
    }

    @Test
    fun `filename with reserved characters - remove them`() {
        val result = FilenameSanitizer.sanitize("Книга: часть 1?.pdf")
        assertEquals("Книга часть 1.pdf", result)
    }

    @Test
    fun `filename with asterisk and quotes - remove them`() {
        val result = FilenameSanitizer.sanitize("Документ \"важный\" *.pdf")
        assertEquals("Документ важный .pdf", result)
    }
}
