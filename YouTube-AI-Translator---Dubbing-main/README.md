# 🎬 YouTube AI Translator & Dubber

<div align="center">

![Version](https://img.shields.io/badge/version-1.0.0-blue.svg)
![License](https://img.shields.io/badge/license-MIT-green.svg)
![Chrome](https://img.shields.io/badge/chrome-extension-yellow.svg)
![Status](https://img.shields.io/badge/status-active-success.svg)

**Translate and dub YouTube videos in real-time using AI**

[Features](#-features) • [Installation](#-installation) • [Contributing](#-contributing) • [Roadmap](#-roadmap)

</div>

---

## 👨‍💻 Author

**Đoàn Thuật IT**
- GitHub: [@doanthuatit](https://github.com/Doanthuat) 
- Email: [EMAIL_ADDRESS] 

---

## 📖 About The Project

YouTube AI Translator & Dubber is a powerful Chrome extension that breaks language barriers by providing real-time translation and dubbing for YouTube videos. Using Google's Gemini AI, it delivers accurate translations in 13 languages with synchronized subtitles and optional text-to-speech dubbing.

### Built With

- Chrome Extension Manifest V3
- Google Gemini AI API
- Vanilla JavaScript (no dependencies!)
- Custom Transcription API
- Web Speech API

---

## ✨ Features

- 🌍 **13 Languages**: Arabic, Chinese, English, French, German, Hindi, Italian, Japanese, Korean, Portuguese, Russian, Spanish, Turkish
- 🤖 **AI-Powered**: Gemini Pro for accurate, context-aware translations
- 🎯 **Real-time Subtitles**: Synced perfectly with video playback
- 🔊 **Auto-Dubbing**: Text-to-speech in target language
- 📊 **Progress Tracking**: Visual feedback during translation
- 💾 **Smart Caching**: Translated videos cached for instant replay
- 🎨 **Beautiful UI**: Modern gradient design with smooth animations
- ⚡ **Fast Processing**: Batch translation (5 segments/sec)
- 🔒 **Privacy First**: All data stored locally

---

## 🚀 Installation

### For Users

1. **Clone the repository**
   ```bash
   git clone https://github.com/doanthuatit/YouTube-AI-Translator---Dubbing.git
   cd youtube-ai-translator
   ```

2. **Create icon files**
   - Add three PNG icons in `icons/` folder:
     - `icon16.png` (16x16px)
     - `icon48.png` (48x48px)
     - `icon128.png` (128x128px)

3. **Load in Chrome**
   - Open `chrome://extensions/`
   - Enable "Developer mode"
   - Click "Load unpacked"
   - Select the project folder

4. **Get API Key**
   - Visit [Google AI Studio](https://aistudio.google.com/app/apikey)
   - Generate a Gemini API key
   - Enter it in the extension popup

5. **Start Translating!**
   - Go to any YouTube video
   - Click the extension icon
   - Select target language
   - Click "Translate & Dub Video"

### For Developers

```bash
git clone https://github.com/doanthuatit/YouTube-AI-Translator---Dubbing.git
cd youtube-ai-translator
# No build process needed - pure vanilla JS!
```

---

## 🤝 Contributing

We're actively looking for contributors to help make this project even better! Whether you're a developer, designer, or language expert, there's a place for you here.

### 🌟 How Can You Help?

#### For Developers
- 🐛 **Fix Bugs**: Check our [Issues](../../issues) page
- ✨ **Add Features**: See our [Roadmap](#-roadmap) below
- 🔧 **Improve Performance**: Optimize translation speed
- 📝 **Documentation**: Improve code comments and guides
- 🧪 **Testing**: Write tests and report edge cases

#### For Designers
- 🎨 **UI/UX Improvements**: Make it prettier and more intuitive
- 🖼️ **Create Icons**: Design better extension icons
- 📱 **Responsive Design**: Improve mobile YouTube support

#### For Language Experts
- 🌍 **Translation Quality**: Review and improve translations
- 🗣️ **Add Languages**: Help us support more languages
- 📖 **Localization**: Translate the extension UI

---

## 📋 Current Roadmap

### 🔥 High Priority
- [ ] **Advanced TTS Integration** - Replace Web Speech API with premium TTS (Google Cloud TTS, ElevenLabs)
- [ ] **Subtitle Export** - Download translated subtitles in SRT/VTT format
- [ ] **Playlist Support** - Auto-translate entire playlists
- [ ] **Speed Controls** - Adjust translation/dubbing speed independently

### 🚀 Medium Priority
- [ ] **Custom Subtitle Styling** - Font, size, color, position customization
- [ ] **Multiple Audio Tracks** - Switch between original and dubbed audio
- [ ] **Offline Mode** - Cache translations for offline viewing
- [ ] **Translation History** - View previously translated videos
- [ ] **Keyboard Shortcuts** - Quick access to features

### 💡 Future Ideas
- [ ] **Live Stream Support** - Real-time translation for live videos
- [ ] **Collaborative Translations** - Community-improved translations
- [ ] **Video Platform Expansion** - Support Vimeo, Dailymotion, etc.
- [ ] **AI Voice Cloning** - Match original speaker's voice characteristics
- [ ] **Sentiment Analysis** - Preserve emotional tone in translations
- [ ] **Technical Term Database** - Accurate translation for specialized content

---

## 🛠️ Technical Architecture

```
youtube-ai-translator/
├── manifest.json           # Extension configuration
├── popup.html             # Extension popup UI
├── popup.js               # Popup logic & settings
├── content.js             # Main translation engine
├── styles.css             # UI styling
├── background.js          # Service worker
├── icons/                 # Extension icons
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png
└── README.md             # This file
```

### Key Components

1. **Content Script** (`content.js`)
   - Injects into YouTube pages
   - Fetches transcriptions from API
   - Manages translation workflow
   - Syncs subtitles with video

2. **Popup Interface** (`popup.html/js`)
   - User settings and preferences
   - API key management
   - Language selection
   - Translation triggers

3. **Background Service** (`background.js`)
   - Extension lifecycle management
   - Tab monitoring
   - Auto-translate functionality

### API Integrations

- **Transcription API**: `https://transcription.hottestdigital.com/transcript?v=<video-id>`
- **Gemini API**: `https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent`

---

## 🚀 Getting Started with Development

### Prerequisites
- Chrome Browser (v88+)
- Gemini API Key
- Basic JavaScript knowledge

### Development Setup

1. **Fork this repository**
2. **Create a feature branch**
   ```bash
   git checkout -b feature/amazing-feature
   ```

3. **Make your changes**
   - Follow the existing code style
   - Add comments for complex logic
   - Test thoroughly on YouTube

4. **Test your changes**
   - Load extension in Chrome
   - Test on multiple videos
   - Check console for errors

5. **Commit your changes**
   ```bash
   git commit -m "Add amazing feature"
   ```

6. **Push to your branch**
   ```bash
   git push origin feature/amazing-feature
   ```

7. **Open a Pull Request**
   - Describe your changes clearly
   - Reference any related issues
   - Add screenshots if UI changes

---

## 📝 Code Style Guidelines

- Use **camelCase** for variables and functions
- Use **PascalCase** for classes
- Add **JSDoc comments** for functions
- Keep functions **small and focused**
- Use **async/await** over promises
- Handle **all errors gracefully**
- Write **descriptive commit messages**

Example:
```javascript
/**
 * Translates text using Gemini AI
 * @param {string} text - Text to translate
 * @param {string} targetLang - Target language code
 * @param {string} apiKey - Gemini API key
 * @returns {Promise<string>} Translated text
 */
async function translateWithGemini(text, targetLang, apiKey) {
  // Implementation
}
```

---

## 🐛 Bug Reports

Found a bug? Please open an issue with:
- **Clear title** describing the problem
- **Steps to reproduce** the bug
- **Expected behavior** vs actual behavior
- **Screenshots** if applicable
- **Browser version** and OS
- **Error messages** from console

---

## 💡 Feature Requests

Have an idea? We'd love to hear it! Open an issue with:
- **Feature description** - What should it do?
- **Use case** - Why is it useful?
- **Implementation ideas** - How might it work?
- **Mockups** - Visual representation (optional)

---

## 📊 Project Stats

- **Total Lines of Code**: ~1,500
- **Languages Used**: JavaScript, HTML, CSS
- **API Calls**: 2 (Transcription + Gemini)
- **Supported Languages**: 13
- **Dependencies**: 0 (pure vanilla!)

---

## 🌍 Translation Quality

We use Gemini Pro with temperature 0.3 for consistent, accurate translations. However, AI isn't perfect. If you notice translation errors:

1. Open an issue with the video URL
2. Specify the timestamp
3. Provide the incorrect translation
4. Suggest the correct translation

---

## 📄 License

Distributed under the MIT License. See `LICENSE` for more information.

---

## 🙏 Acknowledgments

- **Google Gemini AI** - For powerful translation capabilities
- **YouTube** - For the platform we enhance
- **Chrome Extensions Team** - For excellent documentation
- **Open Source Community** - For inspiration and support

---

## 📞 Contact & Support

- **Issues**: [GitHub Issues](../../issues)
- **Email**: toumirttv@gmail.com 

---

## ⭐ Show Your Support

If you find this project helpful, please consider:
- ⭐ Starring the repository
- 🐛 Reporting bugs
- 💡 Suggesting features
- 🤝 Contributing code
- 📢 Sharing with others

---

<div align="center">

**Made with ❤️ by Đoàn Thuật IT**

*Let's break language barriers together!* 🌍

[⬆ Back to Top](#-youtube-ai-translator--dubber)

</div>