# LetSeeGold – Giá vàng & tỉ giá hôm nay

Trang web xem **giá vàng mua vào / bán ra** tại các cửa hàng uy tín và **tỉ giá USD, JPY, KRW**, có **lịch tự cập nhật** theo khung giờ người dùng chọn.

🌐 Địa chỉ công khai (sau khi bật GitHub Pages): **https://maingochoanglong.github.io/LetSeeGold/**

## Tính năng

- **Giá vàng miếng SJC tại các cửa hàng** là màn hình chính: PNJ, Mi Hồng, Bảo Tín Mạnh Hải, Phú Quý, Ngọc Thẩm, DOJI, Bảo Tín Minh Châu, SJC. Mỗi dòng có:
  - giá mua vào, bán ra và mức tăng/giảm (▲▼) so với cuối ngày hôm trước;
  - nguồn: website chính hãng hay qua trang tổng hợp;
  - giờ cửa hàng niêm yết.

  Tiệm mua vào cao nhất và bán ra thấp nhất được tô nổi bật. Có thể chuyển sang so sánh nhẫn trơn 9999.
- **Bảng giá đầy đủ của từng tiệm:** bấm tên tiệm để xem.
- **Giá vàng thế giới** (USD/oz), quy đổi ra đ/lượng, kèm chênh lệch so với SJC.
- **Đổi đơn vị** giữa đ/lượng và đ/chỉ.
- **Tỉ giá Vietcombank** cho USD, JPY, KRW: mua tiền mặt, mua chuyển khoản, bán ra.
- **Quy đổi tiền tệ** giữa VND, USD, JPY và KRW theo giá ngân hàng mua vào / bán ra.
- **Lịch cập nhật** do người dùng tự chọn và được lưu lại trên máy:
  - *Theo giờ cố định*: ví dụ 08:30, 11:30, 14:30, 17:00 mỗi ngày.
  - *Định kỳ trong khung giờ*: ví dụ mỗi 15 phút, từ 08:00 đến 18:00.
  - *Thủ công*: chỉ cập nhật khi bấm nút.
  - Tuỳ chọn hiện **thông báo** khi đến giờ cập nhật, hoặc chỉ khi giá thay đổi.
- Giao diện tiếng Việt, dùng tốt trên điện thoại, hỗ trợ chế độ tối. Có thể "Thêm vào màn hình chính" như một ứng dụng.

## Chi phí: 0 đồng

| Thành phần | Dịch vụ | Mức miễn phí |
|---|---|---|
| Lưu trữ trang web + tên miền công khai | GitHub Pages | Miễn phí cho repository công khai |
| Lấy giá định kỳ (khoảng 10 phút một lần) | GitHub Actions | Không giới hạn số phút với repository công khai |
| Nguồn dữ liệu | Website / API công khai của các đơn vị | Miễn phí, không cần khoá API |

Không cần máy chủ riêng, cơ sở dữ liệu hay thẻ thanh toán. Repository phải để **Public**.

## Kích hoạt (làm một lần)

1. Vào **Settings → Pages**. Ở mục *Build and deployment → Source*, chọn **GitHub Actions**.
2. Gộp (merge) Pull Request này vào nhánh `main`. Workflow **"Cập nhật giá & triển khai"** sẽ tự chạy.
3. Chờ khoảng 1 phút rồi mở https://maingochoanglong.github.io/LetSeeGold/

Nếu lần chạy đầu bị lỗi vì Pages chưa được bật, hãy bật Pages như bước 1. Sau đó vào tab **Actions**, chọn **"Cập nhật giá & triển khai"** và bấm **Run workflow**.

Từ đó GitHub tự lấy giá mới khoảng mỗi 10 phút và đăng lại trang.

## Cách hoạt động

```
GitHub Actions (≈10 phút/lần)                       Trình duyệt người dùng
┌──────────────────────────────┐                    ┌──────────────────────────────┐
│ scripts/build.mjs            │                    │ index.html + app.js          │
│  • lấy giá 6 cửa hàng        │  data/latest.json  │  • đọc data/latest.json      │
│  • tỉ giá Vietcombank        │ ─────────────────▶ │  • lấy trực tiếp PNJ, Mi Hồng│
│  • giá vàng thế giới         │   GitHub Pages     │    và giá thế giới           │
│  • so với cuối ngày hôm qua  │                    │  • chạy lịch cập nhật        │
└──────────────────────────────┘                    └──────────────────────────────┘
```

- PNJ, Mi Hồng và giá thế giới cho phép trình duyệt đọc trực tiếp. Vì vậy, đến giờ người dùng đã hẹn, trang lấy **giá mới nhất ngay lúc đó** từ các nguồn này.
- Các nguồn còn lại được GitHub Actions lấy về khoảng 10 phút một lần.
- Nếu một nguồn tạm lỗi, trang vẫn hiển thị giá lấy được gần nhất (trong vòng 3 ngày), gắn nhãn "Dữ liệu cũ".

| Cửa hàng | Nguồn |
|---|---|
| PNJ | API trên website PNJ (`edge-api.pnj.io`) |
| Mi Hồng | API trên website Mi Hồng (`api.mihong.vn`) |
| Bảo Tín Mạnh Hải | Trang bảng giá `baotinmanhhai.vn/bang-gia-vang` |
| Phú Quý | Bảng giá trên `phuquygroup.vn` |
| Ngọc Thẩm | Bảng giá trên `ngoctham.com/bang-gia-vang` |
| DOJI | Bảng giá DOJI trên `giavang.org` |
| Bảo Tín Minh Châu | Bảng giá BTMC trên `giavang.org` |
| SJC | Bảng giá SJC trên `giavang.org`. Dự phòng: dữ liệu giá vàng của VnExpress |
| Tỉ giá | Vietcombank. Dự phòng: `open.er-api.com` (tỉ giá trung bình) |
| Giá thế giới | `gold-api.com` |

Website của DOJI, Bảo Tín Minh Châu và SJC chặn truy cập từ ngoài Việt Nam, trong đó có máy chủ GitHub. Vì vậy giá của ba đơn vị này được lấy qua trang tổng hợp giavang.org, và trang ghi rõ "qua giavang.org" ở những dòng đó.

## Lưu ý

- Lịch cập nhật chạy khi trang (hoặc ứng dụng đã thêm vào màn hình chính) **đang mở**. Trình duyệt không cho trang web chạy ngầm khi đã đóng.
- Lịch của GitHub Actions có thể trễ vài phút vào giờ cao điểm.
- Nếu repository không có hoạt động trong 60 ngày, GitHub có thể tự tắt lịch chạy. Workflow đã có bước tự giữ lịch luôn bật. Nếu lịch vẫn bị tắt, vào tab **Actions** và bấm **Enable workflow**.
- Giá chỉ mang tính tham khảo. Khi một cửa hàng đổi website, trang sẽ báo "Chưa lấy được giá" cho cửa hàng đó. Lúc này cần sửa bộ đọc tương ứng trong `site/sources.js`.

## Tuỳ chỉnh

- **Tần suất lấy giá trên máy chủ:** sửa dòng `cron` trong `.github/workflows/deploy.yml` (giờ UTC). Ví dụ `'7,37 * * * *'` là 30 phút một lần.
- **Giờ cập nhật mặc định cho người dùng mới:** sửa `DEFAULTS` trong `site/app.js`.
- **Thêm cửa hàng:** thêm vào `SHOPS` và `GOLD_FETCHERS` trong `site/sources.js`, kèm một bộ đọc và test trong `test/`.

## Phát triển

Yêu cầu Node.js 20 trở lên. Dự án không dùng thư viện ngoài.

```bash
npm test          # chạy test bộ đọc dữ liệu, lịch cập nhật, quy đổi tiền
npm run build     # lấy giá thật, tạo thư mục dist/
npm run preview   # xem dist/ tại http://localhost:8080
```

Cấu trúc thư mục:

```
site/               trang web tĩnh
  index.html, styles.css, app.js
  sources.js        nguồn dữ liệu + bộ đọc (dùng chung cho trình duyệt và máy chủ)
  schedule.js       tính giờ cập nhật tiếp theo
  convert.js        quy đổi tiền tệ
scripts/build.mjs   lấy dữ liệu và tạo dist/
test/               test + dữ liệu mẫu thật trong test/fixtures
```
