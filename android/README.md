# Booklib Android

WebView-клиент для домашнего Booklib — локального веб-каталога библиотеки.

## Описание

Приложение открывает `https://archlinux.local/` в полноэкранном WebView без адресной строки. Предназначено для установки на Android-телефон для доступа к каталогу книг в домашней сети.

## Требования

- JDK 17 (рекомендуется)
- Android SDK (compileSdk 35, minSdk 26)
- Интернет для первой сборки (Gradle скачивает зависимости)

## Сборка

```bash
cd android
./gradlew assembleDebug
```

Готовый APK:
```
android/app/build/outputs/apk/debug/app-debug.apk
```

## Установка через ADB

```bash
adb install -r android/app/build/outputs/apk/debug/app-debug.apk
```

## Настройка сервера

Приложение работает с Booklib по адресу `https://archlinux.local/`.

Необходимо:
1. Booklib запущен на ПК в той же сети
2. Caddy настроен с HTTPS для `archlinux.local`
3. CA-сертификат установлен на телефон или встроен в APK

## CA-сертификат

APK содержит встроенный публичный CA-сертификат в `app/src/main/res/raw/booklib_ca.crt`.

### Как работает доверие

**WebView** использует встроенный CA-сертификат через `network_security_config.xml`. Это позволяет приложению открывать `https://archlinux.local/` без установки сертификата в систему.

**DownloadManager** (системный компонент Android) **не использует** network security config приложения. Для скачивания файлов требуется, чтобы CA-сертификат был установлен в **системное хранилище доверенных сертификатов Android**.

**Важно для Android 7+:** На Android 7.0 и выше user-installed CA (установленные пользователем) по умолчанию **не доверяются** приложениями, если они явно не opt-in через `trust-anchors user` в network security config. Это означает:
- WebView работает (использует встроенный CA из APK)
- DownloadManager может не работать даже после установки CA в Android

**Решение для DownloadManager:**
1. Установить CA в Android (Настройки → Безопасность → Установка сертификата → CA-сертификат)
2. На Android 7+ может потребоваться дополнительная настройка или использование альтернативного метода скачивания
3. Альтернатива: скачивание через WebView (но потеряется поддержка Range-запросов и больших файлов)

### Установка CA-сертификата в Android

1. Скопируйте `ca-cert.pem` с ПК на телефон (через USB, email, файловый сервер)
2. На телефоне: **Настройки → Безопасность → Шифрование и учётные данные → Установка сертификата → CA-сертификат**
3. Выберите файл `ca-cert.pem`
4. Подтвердите установку

После установки:
- Каталог книг открывается в WebView
- Скачивание файлов работает через DownloadManager

**Без установки CA в Android:**
- Каталог может открываться (WebView доверяет встроенному CA)
- Скачивание файлов **не работает** (DownloadManager не доверяет встроенному CA)

### Fingerprint CA-сертификата

```
SHA-256: 22:EA:29:D5:A9:1F:25:2E:35:0C:0E:E1:2E:28:BC:65:5E:E1:1E:0D:DB:A9:D9:C0:BB:6A:67:C6:CA:5D:98:61
```

Проверка:
```bash
openssl x509 -in android/app/src/main/res/raw/booklib_ca.crt -noout -fingerprint -sha256
```

### Замена CA-сертификата

При замене CA-сертификата необходимо:
1. Обновить файл `app/src/main/res/raw/booklib_ca.crt`
2. Пересобрать APK
3. Переустановить на устройства
4. Переустановить CA-сертификат в Android на всех устройствах

**Важно:** Никогда не используйте `handler.proceed()` в `onReceivedSslError`, небезопасные TrustManager или отключение hostname verification. Это создаёт уязвимости.

## Версионирование

При изменении приложения увеличьте `versionCode` в `app/build.gradle.kts`:

```kotlin
defaultConfig {
    versionCode = 2  // увеличить на 1
    versionName = "1.1"
}
```

## Debug vs Release

- **Debug**: подписан debug-ключом, не требует minification
- **Release**: требует signing config и proguard-rules

Для production используйте:
```bash
./gradlew assembleRelease
```

## Ограничения

- ПК с Booklib должен быть включён и доступен в сети
- HTTPS-сертификат должен быть доверен (встроен в APK или установлен на устройство)
- Приложение не работает без подключения к серверу

## Структура проекта

```
android/
├── app/
│   ├── build.gradle.kts
│   ├── proguard-rules.pro
│   └── src/main/
│       ├── AndroidManifest.xml
│       ├── java/io/github/megannnn98/booklib/
│       │   └── MainActivity.kt
│       └── res/
│           ├── drawable/          # Vector icons
│           ├── layout/            # UI layouts
│           ├── mipmap-*/          # Launcher icons
│           ├── raw/               # CA certificate
│           ├── values/            # Strings, colors, themes
│           └── xml/               # Network security config
├── build.gradle.kts
├── settings.gradle.kts
└── gradle/wrapper/                # Gradle wrapper
```

## Безопасность

- JavaScript включён (требуется для Booklib UI)
- DOM storage включён
- Mixed content запрещён
- Cleartext HTTP запрещён
- Доступ к локальным файлам отключён
- Доступ к content:// отключён
- Safe Browsing включён
- Нет JavaScript bridge
- Внешние ссылки открываются в системном браузере
- Скачивание файлов через системный DownloadManager

## Лицензия

Часть проекта Booklib.
