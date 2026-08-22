# Локальный HTTPS для PWA на Android

Service worker и установка PWA требуют **secure context**. `localhost` — исключение,
но `http://archlinux.local:8765` на телефоне secure context не является.

Решение: системный Caddy как reverse proxy с локальным CA-сертификатом.

## Архитектура

```
Android-телефон ──HTTPS──▶ Caddy (:443) ──HTTP──▶ Booklib (127.0.0.1:8765)
                                  │
                                  ├── TLS-сертификат от локального CA
                                  ├── X-Booklib-Remote: 1 для проксированных запросов
                                  └── CA-сертификат установлен на телефоне
```

Booklib продолжает слушать `127.0.0.1:8765` и не знает о TLS. Caddy принудительно
ставит заголовок `X-Booklib-Remote: 1` для всех проксированных запросов, чтобы
Booklib считал их удалёнными (см. `is_local_request()` в `src/booklib/api/app.py`).

## Обязательные шаги

### 1. Установить Caddy

```bash
sudo pacman -S caddy
```

### 2. Создать локальный CA

```bash
mkdir -p ~/.config/booklib-tls
cd ~/.config/booklib-tls

# Генерация корневого CA
openssl req -x509 -newkey rsa:2048 -keyout ca-key.pem -out ca-cert.pem \
  -days 3650 -nodes -subj "/CN=Booklib Local CA" \
  -addext "basicConstraints=critical,CA:TRUE" \
  -addext "keyUsage=critical,keyCertSign,cRLSign"
```

**Важно:** `ca-key.pem` — приватный ключ CA. Не копируйте его в `/etc/caddy` и не
публикуйте. Он нужен только для подписи серверных сертификатов.

### 3. Сгенерировать сертификат для хоста

```bash
# Заменить archlinux.local на реальное mDNS-имя хоста в сети
HOSTNAME="archlinux.local"

openssl req -newkey rsa:2048 -keyout server-key.pem -out server-req.pem \
  -nodes -subj "/CN=${HOSTNAME}" \
  -addext "subjectAltName=DNS:${HOSTNAME}"

openssl x509 -req -in server-req.pem -CA ca-cert.pem -CAkey ca-key.pem \
  -CAcreateserial -out server-cert.pem -days 825 \
  -copy_extensions copyall
```

### 4. Установить серверный сертификат для Caddy

```bash
sudo mkdir -p /etc/caddy/certs
sudo cp ~/.config/booklib-tls/server-cert.pem /etc/caddy/certs/booklib-server-cert.pem
sudo cp ~/.config/booklib-tls/server-key.pem /etc/caddy/certs/booklib-server-key.pem
sudo chown root:caddy /etc/caddy/certs/booklib-server-*.pem
sudo chmod 640 /etc/caddy/certs/booklib-server-*.pem
```

**Важно:** копируем только серверный сертификат и серверный приватный ключ. Приватный
ключ CA (`ca-key.pem`) остаётся в `~/.config/booklib-tls/` и не передаётся Caddy.

### 5. Конфигурация Caddy

Создать `/etc/caddy/Caddyfile`:

```caddyfile
https://archlinux.local {
    tls /etc/caddy/certs/booklib-server-cert.pem /etc/caddy/certs/booklib-server-key.pem

    reverse_proxy 127.0.0.1:8765 {
        header_up X-Booklib-Remote "1"
    }
}
```

Заголовок `X-Booklib-Remote: 1` сообщает Booklib, что запрос пришёл через прокси
от удалённого клиента. Booklib использует этот заголовок только для понижения прав
(считать запрос удалённым), но никогда для повышения.

### 6. Проверить конфигурацию

```bash
sudo caddy validate --config /etc/caddy/Caddyfile
```

Ожидаемый вывод: `Valid configuration`.

### 7. Запустить Caddy

```bash
sudo systemctl enable --now caddy
```

Проверить состояние:

```bash
sudo systemctl status caddy
```

Просмотр журнала:

```bash
sudo journalctl -u caddy -n 50 --no-pager
```

### 8. Открыть порт в firewall (если активен)

```bash
sudo firewall-cmd --permanent --add-service=https
sudo firewall-cmd --reload
```

### 9. URL для PWA

После настройки PWA открывается по адресу:

```
https://archlinux.local/
```

(Заменить `archlinux.local` на реальное mDNS-имя хоста.)

## Установка корневого CA на Android

Без этого шага Android покажет ошибку сертификата и PWA не установится.

1. Скопировать `ca-cert.pem` на телефон (по почте, USB, QR-коду).
2. Настройки → Безопасность → Шифрование и учётные данные → Установка сертификата → CA-сертификат.
   - Путь может отличаться: на некоторых версиях Android — Настройки → Безопасность → Дополнительно → Шифрование и учётные данные → Установка сертификата → CA-сертификат.
3. Выбрать файл `ca-cert.pem`.
4. Android потребует PIN/пароль блокировки экрана.
5. Подтвердить установку.

Проверка: Настройки → Безопасность → Шифрование и учётные данные → Доверенные учётные данные → Вкладка «Пользователь» — должен появиться «Booklib Local CA».

После этого Chrome по `https://archlinux.local/` не будет показывать предупреждение о сертификате.

## Проверка работы

1. На ПК: `http://localhost:8765` — `status.local=true`, административные кнопки видны.
2. На телефоне: `https://archlinux.local/` — `status.local=false`, административные кнопки скрыты, теги загружаются, клик по книге открывает список файлов для скачивания.
3. Административные запросы (`/api/open`, `/api/rescan`, `/api/settings`) через Caddy возвращают `403`.

## Обновление сертификата

Сертификат выпущен на 825 дней (~2.3 года). Перед истечением повторить шаги 3–4
и перезапустить Caddy:

```bash
sudo systemctl reload caddy
```

## mDNS-имя

Если `archlinux.local` разрешается через mDNS (Avahi/nss-mdns), дополнительных
настроек DNS не нужно. Проверить:

```bash
getent hosts archlinux.local
```

Если не разрешается — установить `nss-mdns` и включить `avahi-daemon`:

```bash
sudo pacman -S nss-mdns
sudo systemctl enable --now avahi-daemon
```

## Безопасность

- Приватный ключ CA (`ca-key.pem`) хранится только в `~/.config/booklib-tls/` и не
  передаётся Caddy или другим сервисам.
- Серверный приватный ключ (`booklib-server-key.pem`) доступен только пользователю
  `root` и группе `caddy` (права `640`).
- `X-Forwarded-For` намеренно игнорируется в Booklib (CLAUDE.md, инвариант №3) —
  доверие заголовку от произвольного клиента в сети небезопасно.
- Booklib по-прежнему слушает только `127.0.0.1` — Caddy проксирует локально.
- `require_local` в Booklib проверяет `request.client.host` и заголовок
  `X-Booklib-Remote`. За Caddy `client.host` всегда `127.0.0.1`, но заголовок
  `X-Booklib-Remote: 1` помечает запрос как удалённый.

### Предположения модели доверия

Корректность схемы требует двух свойств:

1. **Caddy — единственный процесс, способный соединиться с `127.0.0.1:8765`.**
   Любой другой локальный процесс может отправлять запросы напрямую без маркера
   и получать полные привилегии. Это допустимо для домашнего ПК, но требует
   контроля запущенных процессов.

2. **Caddy всегда перезаписывает `X-Booklib-Remote` (не дописывает).**
   Конструкция `header_up X-Booklib-Remote "1"` заменяет все существующие значения.
   Если бы Caddy дописывал значение, клиент мог бы подложить `X-Booklib-Remote: 0`
   перед маркером и обойти проверку. Booklib защищает от этого проверкой всех
   значений заголовка (`getlist`), но корректная конфигурация Caddy — первичная
   гарантия.

3. **`BOOKLIB_HOST` остаётся `127.0.0.1` (по умолчанию).**
   При `BOOKLIB_HOST=0.0.0.0` любой хост сети может соединиться напрямую и
   подделать заголовок `X-Booklib-Remote`. Эта схема рассчитана на дефолтный host.

## Ограничения

- Полноценная авторизация/токены — отдельная задача. Текущая схема подходит для
  домашнего использования без публикации в интернет.
- Приватные ключи и сертификаты не коммитятся в репозиторий.
