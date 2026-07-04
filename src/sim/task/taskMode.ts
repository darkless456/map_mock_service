export function taskModeFromCreateInfo(taskInfo: Record<string, unknown>): string {
  switch (taskInfo.task_mode) {
    case 'area':
    case 'region':
      return 'MOW_REGION';
    case 'edge':
      return 'MOW_EDGE';
    default:
      return 'MOW_GLOBAL';
  }
}
