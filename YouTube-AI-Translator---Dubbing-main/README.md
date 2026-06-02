# 🎬 YouTube AI Translator & Dubber

<div align="center">

![Version](https://img.shields.io/badge/version-1.1.0-blue.svg)
![License](https://img.shields.io/badge/license-MIT-green.svg)
![Chrome](https://img.shields.io/badge/chrome-extension-yellow.svg)
![Status](https://img.shields.io/badge/status-active-success.svg)

**Dịch và lồng tiếng video YouTube theo thời gian thực bằng AI**

[Tính năng](#-tính-năng) • [Cài đặt](#-cài-đặt) • [Đóng góp](#-đóng-góp) • [Lộ trình](#-lộ-trình)

</div>

---

## 👨‍💻 Tác giả

**Đoàn Thuật IT**
- GitHub: [@doanthuatit](https://github.com/Doanthuat) 
- Email: toumirttv@gmail.com 

---

## 📖 Về dự án

YouTube AI Translator & Dubber là một tiện ích mở rộng mạnh mẽ trên Chrome giúp xóa bỏ rào cản ngôn ngữ bằng cách cung cấp tính năng dịch thuật và lồng tiếng (dubbing) theo thời gian thực cho các video YouTube. Tiện ích sử dụng Google Cloud TTS và Gemini AI, kết hợp với các cơ chế đồng bộ hóa độ trễ thấp để mang lại trải nghiệm xem mượt mà nhất.

### Xây dựng bằng

- Chrome Extension Manifest V3
- Google Cloud Text-to-Speech (TTS) API
- Google Gemini AI API
- Vanilla JavaScript (Không sử dụng thư viện bên ngoài!)
- Web Speech API & Web Audio API (AudioContext)
- API Phụ đề nội bộ của YouTube (Timedtext JSON3)

---

## ✨ Tính năng nổi bật

- 🎯 **Lồng tiếng thời gian thực (Real-time Dubbing):** Bỏ qua cơ chế hàng đợi truyền thống (Queue Bypass), khớp chính xác đến từng mili-giây với video gốc. Không bị dồn ứ, không bị trễ nhịp.
- ☁️ **Google Cloud TTS:** Tích hợp tùy chọn giọng đọc chất lượng cao, tự nhiên và mượt mà bên cạnh giọng đọc mặc định của hệ thống.
- ⚡ **Ưu tiên phụ đề gốc (Smart Timedtext):** Tự động bắt bản dịch có sẵn của YouTube (tlang) giúp hiển thị phụ đề và lồng tiếng siêu tốc mà không tốn API dịch thuật.
- 🔄 **Xử lý linh hoạt trạng thái Video:** Tự động điều chỉnh khi người dùng thay đổi tốc độ phát (x1.5, x2.0...), khi tua video (seek) hoặc khi mạng lag (buffering), đảm bảo âm thanh không bao giờ phát sai lệch.
- 🎚️ **Kiểm soát âm lượng độc lập:** Cho phép tùy chỉnh thanh âm lượng riêng biệt cho video gốc và giọng lồng tiếng trực tiếp ngay trên màn hình.
- 🌍 **13 Ngôn ngữ hỗ trợ:** Tiếng Việt, Tiếng Ả Rập, Tiếng Trung, Tiếng Anh, Tiếng Pháp, Tiếng Đức, Tiếng Hindi, Tiếng Ý, Tiếng Nhật, Tiếng Hàn, Tiếng Bồ Đào Nha, Tiếng Nga, Tiếng Tây Ban Nha, Tiếng Thổ Nhĩ Kỳ.
- 🚀 **Bộ đệm thông minh (Audio Prefetch):** Tải trước âm thanh 4 giây giúp triệt tiêu hoàn toàn độ trễ của mạng.

---

## 🚀 Cài đặt

### Dành cho người dùng

1. **Tải mã nguồn**
   ```bash
   git clone https://github.com/doanthuatit/YouTube-AI-Translator---Dubbing.git
   cd youtube-ai-translator
   ```

2. **Cài đặt vào Chrome**
   - Mở trình duyệt Chrome và truy cập `chrome://extensions/`
   - Bật chế độ "Developer mode" (Chế độ dành cho nhà phát triển) ở góc trên bên phải.
   - Nhấn vào "Load unpacked" (Tải tiện ích đã giải nén).
   - Chọn thư mục dự án bạn vừa tải về.

3. **Lấy khóa API (API Key)**
   - **Google Cloud TTS:** Lấy API key tại Google Cloud Console (Dành cho giọng đọc chất lượng cao).
   - **Gemini AI:** Lấy API key tại [Google AI Studio](https://aistudio.google.com/app/apikey) (Dành cho việc dịch phụ đề tiếng Anh sang tiếng Việt).
   - Mở tiện ích lên và nhập các API key này vào phần cài đặt.

4. **Bắt đầu sử dụng!**
   - Mở bất kỳ video YouTube nào.
   - Click vào icon của tiện ích ở góc màn hình.
   - Chọn giọng đọc và nhấn "Dịch".
   - Bật/Tắt Lồng tiếng theo ý thích.

---

## 🛠️ Cấu trúc kỹ thuật của Web Extension

```
youtube-ai-translator/
├── manifest.json           # Cấu hình tiện ích (Manifest V3)
├── popup.html             # Giao diện cài đặt popup
├── popup.js               # Xử lý logic và lưu trữ tùy chọn của popup
├── content.js             # File cốt lõi xử lý dịch, chèn UI, và lồng tiếng (AudioContext)
├── styles.css             # Định dạng CSS cho giao diện hiển thị trên YouTube
├── background.js          # Service worker (Proxy gọi API Cloud TTS & Gemini)
├── icons/                 # Icon của tiện ích
└── README.md             # File hướng dẫn (bạn đang đọc)
```

### Các thành phần chính

1. **Content Script** (`content.js`)
   - **Giao diện (UI):** Tạo lớp phủ giao diện điều khiển (âm lượng, trạng thái) ngay trên video YouTube.
   - **Phụ đề (Transcription):** Đọc trực tiếp file `json3` từ YouTube hoặc gọi API để lấy text. Ưu tiên lấy bản dịch nội bộ `tlang` của YouTube để đồng bộ 100%.
   - **Động cơ lồng tiếng (TTS Engine):** Lập lịch bằng `setTimeout` có tính toán độ trễ mạng, tốc độ phát `playbackRate`, và dùng `AudioContext` để phát trực tiếp Google Cloud TTS. Tự động dọn dẹp luồng âm thanh khi có sự kiện `pause`, `seeked`, hoặc `waiting` của video.

2. **Popup Interface** (`popup.html/js`)
   - Lưu trữ các khóa API (Gemini, Google Cloud TTS).
   - Lựa chọn nguồn giọng đọc (Hệ thống hoặc Cloud TTS) và ngôn ngữ đầu ra.

3. **Background Service** (`background.js`)
   - Đóng vai trò proxy trung gian để gọi API bên ngoài (Gemini và Cloud TTS) nhằm tránh các lỗi CORS khi gọi trực tiếp từ trang web.

---

## 🤝 Đóng góp

Chúng tôi luôn hoan nghênh mọi đóng góp để làm cho dự án này trở nên tuyệt vời hơn! Cho dù bạn là lập trình viên, nhà thiết kế hay chuyên gia ngôn ngữ.

### 🌟 Bạn có thể giúp gì?

- 🐛 **Sửa lỗi:** Kiểm tra phần [Issues](../../issues).
- ✨ **Thêm tính năng:** Hiện thực hoá các ý tưởng trong phần [Lộ trình](#-lộ-trình).
- 🎨 **Cải thiện UI/UX:** Làm cho tiện ích hiển thị đẹp và chuyên nghiệp hơn.

---

## 📋 Lộ trình phát triển

### 🔥 Ưu tiên cao
- [x] **Tích hợp TTS Nâng cao** - Bổ sung Google Cloud TTS để có giọng đọc chân thực.
- [x] **Đồng bộ thời gian thực** - Không còn bị lag hay dồn chữ khi xem.
- [ ] **Tự động lưu lịch sử** - Lưu cache phụ đề để lần sau xem không cần dịch lại.

### 🚀 Ưu tiên trung bình
- [ ] **Tùy chỉnh phụ đề** - Đổi font chữ, màu sắc, vị trí hiển thị của phụ đề.
- [ ] **Xuất file phụ đề** - Tải xuống file SRT/VTT sau khi dịch xong.

---

## 📝 Quy tắc viết Code

- Sử dụng **camelCase** cho tên biến và hàm.
- Giữ các hàm **ngắn gọn và tập trung** vào một nhiệm vụ (Single Responsibility).
- Ưu tiên sử dụng **async/await**.
- Quản lý lỗi nghiêm ngặt: đảm bảo rác bộ nhớ (timer, AudioNode) được xóa sạch khi xảy ra lỗi mạng hoặc người dùng tua video.

---

## 📄 Giấy phép

Dự án được phân phối dưới giấy phép MIT. Xem file `LICENSE` để biết thêm chi tiết.

---

<div align="center">

**Phát triển bằng tất cả ❤️ bởi Đoàn Thuật IT**

*Cùng nhau xóa bỏ rào cản ngôn ngữ!* 🌍

[⬆ Lên đầu trang](#-youtube-ai-translator--dubber)

</div>
