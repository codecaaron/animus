export enum Selectors {
  hover = "&:hover&:not([disabled], :active)",
  disabled = '&:disabled, &[disabled], &[aria-disabled="true"]',
  focus = "&:focus-visible&:after",
  active = "&:active",
}
