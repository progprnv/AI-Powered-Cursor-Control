// AiCursor standalone project file.
// Tools split into safe (auto-execute) and approval-required (need user
// confirmation). Safe tools only read data. Approval-required tools take
// actions on the user's machine (open URL, write clipboard, save file,
// reveal in finder).

const APPROVAL_REQUIRED = new Set<string>([
  'open_url',
  'copy_to_clipboard',
  'save_document',
  'reveal_in_finder',
]);

export function getApprovalRequiredTools(): Set<string> {
  return APPROVAL_REQUIRED;
}

export function isApprovalRequired(toolName: string): boolean {
  return APPROVAL_REQUIRED.has(toolName);
}
