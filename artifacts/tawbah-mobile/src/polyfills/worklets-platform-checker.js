// react-native-worklets can evaluate its platform checker before RuntimeKind
// is initialized in the Expo web bundle. This module is only substituted for
// that checker on web builds, where these values are fixed.
export const IS_JEST = false;
export const IS_WEB = true;
export const IS_WINDOWS = false;
export const SHOULD_BE_USE_WEB = true;
