export type MasterDetailPane = "LIST" | "DETAIL";

export function masterDetailPane(
  selectedKey: string | undefined,
): MasterDetailPane {
  return selectedKey === undefined ? "LIST" : "DETAIL";
}

export function masterDetailClassName(selectedKey: string | undefined): string {
  return `squad-content${
    masterDetailPane(selectedKey) === "DETAIL" ? " squad-detail-open" : ""
  }`;
}
