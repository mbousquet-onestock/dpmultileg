export type IconName = string;
export type OsMenuOptionItem = {
  id: string;
  primaryText: string;
  secondaryText?: string;
  icon?: IconName;
  [key: string]: unknown;
};
