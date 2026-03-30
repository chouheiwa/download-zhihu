import type { ThemeConfig } from 'antd';

export const inkWashTheme: ThemeConfig = {
  token: {
    colorPrimary: '#0066FF',
    colorSuccess: '#2D6A4F',
    colorWarning: '#B8860B',
    colorError: '#C03030',
    colorBgBase: '#F4F6F9',
    colorBgContainer: '#FFFFFF',
    colorBorder: '#D4DCE5',
    colorText: '#1A2332',
    colorTextSecondary: '#7B8A9A',
    fontFamily: "-apple-system, BlinkMacSystemFont, 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', sans-serif",
    borderRadius: 4,
  },
  components: {
    Button: { borderRadius: 4 },
    Card: { borderRadius: 8 },
    Segmented: {
      itemSelectedBg: '#0066FF',
      itemSelectedColor: '#FFFFFF',
    },
    Switch: {
      colorPrimary: '#0066FF',
      colorPrimaryHover: '#0052CC',
    },
  },
};
