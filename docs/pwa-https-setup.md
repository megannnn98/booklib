# Локальный HTTPS для PWA на Android

Service worker и установка PWA требуют **secure context**. `localhost` — исключение,
но `http://archlinux.local:8765` на телефоне secure context не является.

Решение: системный Caddy как reverse proxy с локальным CA-сертификатом.

## Архитектура

```
Android-телефон ──HTTPS──▶ Caddy (:443) ──HTTP──▶ Booklib (127.0.0.1:8765)
                                  │
                                  ├── TLS-сертификат от локального CA
                                  ├── Admin только для 192.168.0.0/24
                                  ├── Remote для остальных клиентов
                                  └── CA-сертификат установлен на телефоне
```

Booklib продолжает слушать `127.0.0.1:8765` и не знает о TLS. Caddy удаляет
присланные клиентом маркеры и сам выдаёт `X-Booklib-Admin: 1` только клиентам
доверенной LAN `192.168.0.0/24`; остальные получают `X-Booklib-Remote: 1`.

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

Создать `/etc/caddy/conf.d/booklib.conf` (он импортируется стандартным
`/etc/caddy/Caddyfile`):

```caddyfile
https://archlinux.local {
    tls /etc/caddy/certs/booklib-server-cert.pem /etc/caddy/certs/booklib-server-key.pem

    # Браузер на хосте: marker определяет действие карточки (открыть nemo),
    # но не заменяет Admin policy. Адрес закреплён DHCP lease.
    @host_desktop remote_ip 192.168.0.106
    # Только домашняя LAN, не Docker-подсети.
    @trusted_lan remote_ip 192.168.0.0/24

    handle @host_desktop {
        # Удалить присланные маркеры ДО reverse_proxy.
        request_header -X-Booklib-Admin
        request_header -X-Booklib-Desktop
        request_header -X-Booklib-Remote
        reverse_proxy 127.0.0.1:8765 {
            header_up X-Booklib-Admin "1"
            header_up X-Booklib-Desktop "1"
        }
    }

    handle @trusted_lan {
        # Отдельный обработчик: удалить маркеры ДО reverse_proxy.
        request_header -X-Booklib-Admin
        request_header -X-Booklib-Desktop
        request_header -X-Booklib-Remote
        reverse_proxy 127.0.0.1:8765 {
            header_up X-Booklib-Admin "1"
        }
    }

    handle {
        # Отдельный обработчик: удалить маркеры ДО reverse_proxy.
        request_header -X-Booklib-Admin
        request_header -X-Booklib-Desktop
        request_header -X-Booklib-Remote
        reverse_proxy 127.0.0.1:8765 {
            header_up X-Booklib-Remote "1"
        }
    }
}
```

`remote_ip` использует IP TCP-клиента Caddy, а не `X-Forwarded-For`. Поэтому
заголовки клиента не могут сами выдать права. `@host_desktop` должен содержать
стабильный DHCP-адрес хоста: только эта ветка добавляет Desktop-маркер для
открытия проводника. Любой запрос без него fail-closed показывает список
форматов. Для смены доверенной сети меняйте только CIDR в `@trusted_lan` и
повторно валидируйте конфигурацию.

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

1. На ПК: `http://localhost:8765/api/status` возвращает `local: true`; настройки,
   словарь тегов и «Обновить» видны.
2. На устройстве с IP из `192.168.0.0/24`: `https://archlinux.local/api/status`
   возвращает `local: true`; тот же полный интерфейс и административные API доступны.
3. На устройстве вне этой подсети: статус возвращает `local: false`; интерфейс
   read-only, а `/api/open`, `/api/rescan` и `/api/settings` отвечают `403`.

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

Адрес должен быть LAN-адресом `192.168.0.0/24`, а не адресом Docker
`172.16.0.0/12`. IPv6 mDNS отключён намеренно: Caddy принимает административные
запросы только из доверенной IPv4-подсети. На этом хосте LAN-интерфейс — `enp8s0`;
в `/etc/avahi/avahi-daemon.conf` задайте:

```ini
[server]
allow-interfaces=enp8s0
use-ipv6=no

[publish]
publish-aaaa-on-ipv4=no
```

Затем выполните `sudo systemctl reload avahi-daemon` и повторите `getent hosts
archlinux.local`.

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
- `X-Forwarded-For` и `X-Forwarded-Host` намеренно игнорируются в Booklib:
  запуск Uvicorn выполняется с `proxy_headers=False`, поэтому они не могут
  заменить непосредственный loopback-peer и дать произвольному клиенту
  административные права.
- Booklib по-прежнему слушает только `127.0.0.1` — Caddy проксирует локально.
- `require_local` в Booklib сначала требует `request.client.host` из loopback,
  затем обрабатывает маркеры Caddy. `X-Booklib-Remote: 1` имеет приоритет и
  переводит клиента в read-only; `X-Booklib-Admin: 1` принимается только от
  loopback-peer. Loopback-запрос с `X-Forwarded-*`, но без Admin, тоже
  read-only: пропущенный маркер Caddy не открывает административный API.
  Прямой localhost без forwarded-заголовков остаётся административным.

### Предположения модели доверия

Корректность схемы требует трёх свойств:

1. **Caddy — единственный процесс, способный соединиться с `127.0.0.1:8765`.**
   Любой другой локальный процесс может отправлять запросы напрямую без маркера
   и получать полные привилегии. Это допустимо для домашнего ПК, но требует
   контроля запущенных процессов.

2. **Caddy всегда сначала удаляет оба входящих маркера.**
   `request_header -X-Booklib-Admin` и `request_header -X-Booklib-Remote` —
   отдельный обработчик перед `reverse_proxy`. Только затем `header_up` ставит
   единственный маркер ветки. Нельзя помещать delete и set одного поля в один
   `reverse_proxy`: Caddy применяет delete после set.

3. **`BOOKLIB_HOST` остаётся `127.0.0.1`.**
   Это defence in depth: не-loopback peer всё равно не проходит проверку
   Booklib, но привязка исключает прямой сетевой путь в обход Caddy и снижает
   последствия будущей ошибки в обработке peer.

## Ограничения

- Полноценная авторизация/токены — отдельная задача. Текущая схема подходит для
  домашнего использования без публикации в интернет.
- Приватные ключи и сертификаты не коммитятся в репозиторий.
- `proxy_headers=False` намеренно не даёт Starlette использовать
  `X-Forwarded-Proto`. Если в будущем появится маршрут с автоматически
  построенным абсолютным redirect, его нужно отдельно проверить под HTTPS.
