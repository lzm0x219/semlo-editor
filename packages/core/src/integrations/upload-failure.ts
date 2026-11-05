import { runCleanupSteps } from "../runtime/cleanup";

export function clearFailedUploadBatch(remove: () => void, hide: () => void, message: string) {
  try {
    remove();
  } catch (error) {
    runCleanupSteps(
      [
        () => {
          throw error;
        },
        hide,
      ],
      message,
    );
  }
}

export function cancelFailedUpload(error: unknown, cleanup: () => void, message: string): never {
  runCleanupSteps(
    [
      () => {
        throw error;
      },
      cleanup,
    ],
    message,
  );
  throw error;
}
