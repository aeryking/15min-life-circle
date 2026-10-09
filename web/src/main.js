import { createApp } from 'vue';
import App from './App.vue';
import './styles.css';
import { applyTheme, theme } from './utils/theme.js';

// 挂载前应用主题，避免首屏闪烁
applyTheme(theme.value);

createApp(App).mount('#app');
