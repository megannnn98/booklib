# Локальный HTTPS для PWA на Android

Service worker и установка PWA требуют **secure context**. `localhost` — исключение,
но `http://archlinux.local:8765` на телефоне secure context не является.

Решение: Caddy как reverse proxy с локальным CA-сертификатом, сгенерированным через openssl.

## Архитектура

```
Android-телефон ──HTTPS──▶ Caddy (:443) ──HTTP──▶ Booklib (127.0.0.1:8765)
                                  │
                                  ├── TLS-сертификат от локального CA
                                  ├── Caddy блокирует привилегированные API для не-loopback
                                  └── CA-сертификат установлен на телефоне
```

Booklib продолжает слушать `127.0.0.1:8765` и не знает о TLS.

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

### 4. Конфигурация Caddy

Создать `~/.config/booklib-tls/Caddyfile`:

```caddyfile
https://archlinux.local {
    tls {$HOME}/.config/booklib-tls/server-cert.pem {$HOME}/.config/booklib-tls/server-key.pem

    # Блокируем привилегированные API для не-loopback клиентов.
    # Caddy подключается к Booklib с 127.0.0.1, поэтому require_local в Booklib
    # видит всех проксированных клиентов как локальных. Этот матчер — stopgap
    # до появления авторизации в Booklib.
    @privileged {
        path /api/rescan /api/settings* /api/open /api/book /api/book/* /api/tags /api/tags/*
        not remote_ip 127.0.0.1 ::1
    }
    respond @privileged "Forbidden" 403

    reverse_proxy 127.0.0.1:8765
}
```

> **Важно:** без блока `@privileged` любой хост в локальной сети сможет вызывать
> `/api/open` (запуск процессов), `/api/rescan`, `/api/settings` (смена корня),
> `/api/book` (правка карточек) и мутации `/api/tags`. Caddy подключается к Booklib
> с `127.0.0.1`, поэтому `require_local` в Booklib пропускает всех проксированных
> клиентов. Матчер выше — обязательная часть конфигурации.

### 5. Запустить Caddy

Системный сервис (проще с bind на порт 443):

```bash
sudo systemctl enable --now caddy
```

Или user-сервис (требует capabilities для bind на привилегированный порт):

```bash
# Разрешить caddy bind на порт < 1024 без root
sudo setcap 'cap_net_bind_service=+ep' /usr/bin/caddy

mkdir -p ~/.config/systemd/user
cat > ~/.config/systemd/user/caddy-pwa.service << 'EOF'
[Unit]
Description=Caddy reverse proxy for Booklib PWA
After=network.target

[Service]
ExecStart=/usr/bin/caddy run --config %h/.config/booklib-tls/Caddyfile
Environment=HOME=%h
Restart=on-failure
RestartSec=5

[Install]
WantedBy=default.target
EOF

systemctl --user enable --now caddy-pwa
```

> **Порт 443 в firewall:** убедиться, что порт открыт:
> ```bash
> sudo firewall-cmd --permanent --add-service=https
> sudo firewall-cmd --reload
> ```

### 6. URL для PWA

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

## Опциональные шаги

### Обновление сертификата

Сертификат выпущен на 825 дней (~2.3 года). Перед истечением повторить шаг 3
и перезапустить Caddy. Можно добавить cron/systemd-timer.

### mDNS-имя

Если `archlinux.local` разрешается через mDNS (Avahi/nss-mdns), дополнительных
настроек DNS не нужно. Проверить:

```bash
getent hosts archlinux.local
```

Если не разрешается — установить `nss-mdns` и включить `avahi-daemon`.

### Альтернатива Caddy: nginx + mkcert

Если предпочитаете nginx, можно использовать [`mkcert`](https://github.com/FiloSottile/mkcert)
для генерации доверенных локальных сертификатов (автоматически устанавливает CA в системное хранилище Linux):

```bash
pacman -S mkcert nginx
mkcert -install
mkcert archlinux.local
```

Конфигурация nginx (с блокировкой привилегированных путей, аналогично Caddy):

```nginx
server {
    listen 443 ssl;
    server_name archlinux.local;

    ssl_certificate     /home/<user>/.config/booklib-tls/archlinux.local.pem;
    ssl_certificate_key /home/<user>/.config/booklib-tls/archlinux.local-key.pem;

    # Блокируем привилегированные API для не-loopback клиентов
    location ~ ^/api/(rescan|settings|open|book|tags) {
        if ($remote_addr !~ ^(127\.0\.0\.1|::1)$) {
            return 403;
        }
        proxy_pass http://127.0.0.1:8765;
    }

    location / {
        proxy_pass http://127.0.0.1:8765;
        proxy_set_header Host $host;
    }
}
```

## Ограничения

- Booklib по-прежнему слушает только `127.0.0.1` — Caddy проксирует локально.
- `require_local` в Booklib проверяет `request.client.host`. За Caddy это `127.0.0.1`
  для всех клиентов, поэтому **матчер в Caddy (шаг 4) обязателен**. Без него
  привилегированные API доступны всей локальной сети.
- `X-Forwarded-For` намеренно игнорируется в Booklib (CLAUDE.md, инвариант №3) —
  доверие заголовку от произвольного клиента в сети небезопасно. Полноценное
  решение — авторизация/токены — отдельная задача.
- Приватные ключи и сертификаты не коммитятся в репозиторий.
