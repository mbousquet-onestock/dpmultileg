/**
 * Local fallback for `@onestock-public/design-system`.
 *
 * The real package is private (GCP artifact registry, see README). When it is installed, vite.config.ts resolves
 * `@onestock-public/design-system` to it and this folder is ignored. The components below reproduce the public
 * API (props / events / slots) documented on https://design-system.onestock-retail.com so that the application
 * code is identical in both cases.
 */
import './base.css';
export { default as OsAlert } from './OsAlert.vue';
export { default as OsBadge } from './OsBadge.vue';
export { default as OsButton } from './OsButton.vue';
export { default as OsCardLayout } from './OsCardLayout.vue';
export { default as OsCheckbox } from './OsCheckbox.vue';
export { default as OsCollapse } from './OsCollapse.vue';
export { default as OsDivider } from './OsDivider.vue';
export { default as OsEntity } from './OsEntity.vue';
export { default as OsIcon } from './OsIcon.vue';
export { default as OsInputNumber } from './OsInputNumber.vue';
export { default as OsInputSearch } from './OsInputSearch.vue';
export { default as OsInputText } from './OsInputText.vue';
export { default as OsModal } from './OsModal.vue';
export { default as OsPicto } from './OsPicto.vue';
export { default as OsRadio } from './OsRadio.vue';
export { default as OsSegmentedControls } from './OsSegmentedControls.vue';
export { default as OsSelect } from './OsSelect.vue';
export { default as OsSelectMultiple } from './OsSelectMultiple.vue';
export { default as OsTag } from './OsTag.vue';
export { default as OsText } from './OsText.vue';
export { default as OsTooltip } from './OsTooltip.vue';
export type { OsMenuOptionItem, IconName } from './types';
