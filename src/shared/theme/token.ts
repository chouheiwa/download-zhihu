import type { ThemeConfig } from 'antd';

export const inkWashTheme: ThemeConfig = {
  token: {
    colorPrimary: '#2c3e50',
    colorSuccess: '#27ae60',
    colorWarning: '#d69e2e',
    colorError: '#c0392b',
    colorBgBase: '#f5f0e8',
    colorBgContainer: '#faf6ef',
    colorBorder: '#d4c5a9',
    colorText: '#2c3e50',
    colorTextSecondary: '#666',
    fontFamily: '"Noto Serif SC", "LXGW WenKai", serif',
    borderRadius: 4,
  },
  components: {
    Button: { borderRadius: 6 },
    Card: { borderRadius: 8 },
  },
};
