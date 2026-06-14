# EKLER — sunucuya kurulum (Hetzner + CloudPanel + Docker)

Hedef: Postgres + MinIO + API + Admin hepsi tek sunucuda Docker ile; CloudPanel
önde HTTPS + reverse proxy. Sıfır Supabase.

Elindekiler: Hetzner sunucu ✅, `ekler.app` domain ✅, CloudPanel ✅.

Sonuç adresler:
- `https://api.ekler.app/v1` — API (telefon buna konuşur)
- `https://admin.ekler.app` — yönetim paneli
- `https://storage.ekler.app` — dosyalar (fotoğraf/not)

---

## 1) DNS — 3 alt-adresi sunucuya yönlendir

Domain sağlayıcında (veya Cloudflare'de) sunucunun IP'sine **A kaydı** ekle:

```
api.ekler.app       A   <SUNUCU_IP>
admin.ekler.app     A   <SUNUCU_IP>
storage.ekler.app   A   <SUNUCU_IP>
```

(Cloudflare kullanıyorsan proxy/bulut turuncu DEĞİL, gri/“DNS only” olsun — SSL'i
CloudPanel verecek.) Yayılması birkaç dk sürebilir.

## 2) Sunucuya gir + Docker kur

CloudPanel sunucusuna SSH ile root gir, Docker yoksa kur:

```bash
curl -fsSL https://get.docker.com | sh
docker --version   # çıktı gelmeli
```

## 3) Kodu sunucuya al

```bash
mkdir -p /opt && cd /opt
git clone <BACKEND_REPO_URL> ekler-backend
cd ekler-backend
```

(Repo private ise SSH key veya `https://<token>@github.com/...` kullan.)

## 4) Şifreleri + anahtarları üret

**Ed25519 login anahtarları** (token imzalama):

```bash
openssl genpkey -algorithm ed25519 -out /tmp/priv.pem
openssl pkey -in /tmp/priv.pem -pubout -out /tmp/pub.pem
# .env'e tek satır (\n'li) hali için:
echo "PRIVATE:"; awk 'NF{printf "%s\\n",$0}' /tmp/priv.pem; echo
echo "PUBLIC:";  awk 'NF{printf "%s\\n",$0}' /tmp/pub.pem;  echo
rm /tmp/priv.pem /tmp/pub.pem
```

**Rastgele şifreler** (her CHANGE_ME için ayrı çalıştır):

```bash
openssl rand -base64 32
```

## 5) `.env` dosyasını oluştur + doldur

```bash
cp .env.production.example .env
nano .env
```

Doldur:
- `POSTGRES_PASSWORD` ve `DATABASE_URL` içindeki şifre **aynı** olsun.
- `MINIO_ROOT_USER/PASSWORD` = `STORAGE_ACCESS_KEY_ID/SECRET_ACCESS_KEY`.
- `AUTH_JWT_PRIVATE_KEY` / `AUTH_JWT_PUBLIC_KEY` = adım 4'teki tek-satır PEM'ler (tırnak içinde).
- `AUTH_OTP_PEPPER`, `ADMIN_PASSWORD`, `ADMIN_COOKIE_SECRET` = rastgele.
- `RESEND_API_KEY` + `OTP_EMAIL_FROM` = adım 8 (login mailleri için ŞART).
- `ADMIN_EMAIL` = senin mailin.

## 6) Çalıştır

```bash
docker compose up -d --build
```

İlk açılışta Postgres `00..04` tarifini otomatik yükler (boş veritabanı). Kontrol:

```bash
docker compose ps                     # hepsi "running/healthy"
docker compose logs -f api            # "ekler-api listening on :3010"
curl -s http://127.0.0.1:3010/v1/health   # sağlık cevabı
```

Bir şey patlarsa: `docker compose logs api` / `logs postgres`.

## 7) CloudPanel — 3 reverse-proxy site + SSL

CloudPanel panelinde, her alt-adres için **+ Add Site → Reverse Proxy**:

| Domain | Reverse Proxy URL |
|---|---|
| `api.ekler.app` | `http://127.0.0.1:3010` |
| `admin.ekler.app` | `http://127.0.0.1:3020` |
| `storage.ekler.app` | `http://127.0.0.1:9000` |

Her site için:
- **SSL/TLS → Let's Encrypt** sertifikası al (DNS adım 1 yayılmış olmalı).
- `storage.ekler.app` sitesinde **Vhost/nginx ayarı**na `client_max_body_size 25m;`
  ekle (not dosyaları 20MB'a kadar; yoksa yükleme "413" hatası verir).

Artık `https://api.ekler.app/v1/health` dışarıdan çalışmalı.

## 8) Login mailleri — Resend

OTP ile giriş e-posta gönderir. [resend.com](https://resend.com):
1. Hesap aç, **API key** üret → `.env` `RESEND_API_KEY`.
2. **Domains → ekler.app** ekle, verdiği DNS kayıtlarını domain'e gir (doğrulama).
3. `OTP_EMAIL_FROM` = `EKLER <giris@ekler.app>` (doğrulanan domain'den).
4. `.env`'i güncelledikten sonra: `docker compose up -d` (yeniden okur).

## 9) Mobil uygulamayı yeni sunucuya çevir

RN repo'da (`ekler/.env`):
```
EXPO_PUBLIC_API_URL=https://api.ekler.app/v1
EXPO_PUBLIC_AUTH_BACKEND=node
EXPO_PUBLIC_API_STORAGE=1
# ... mevcut tüm EXPO_PUBLIC_API_* zaten =1
```
Sonra **EAS build** → App Store / Google Play. (Supabase env'leri kaldırılabilir;
önce smoke test, sonra sil.)

---

## Güncelleme (kod değişince)

```bash
cd /opt/ekler-backend && git pull
docker compose up -d --build
```

## Yedek (önemli)

- Veritabanı: `docker compose exec postgres pg_dump -U postgres ekler > yedek.sql`
- Dosyalar: `miniodata` volume'ünü düzenli yedekle.

## Notlar
- Her şey `127.0.0.1`'e bağlı → internete sadece CloudPanel (nginx) üzerinden açık.
- `AUTH_MODE=own_only` + MinIO → sıfır Supabase. Boş başlangıç (veri taşınmıyor).
- Push bildirimi henüz YOK (apps/worker boş) — sonraki faz.
