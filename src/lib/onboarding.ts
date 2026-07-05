const STORAGE_KEY = "searchit.onboardingSeen";

export function hasSeenOnboardingTour(): boolean {
  return localStorage.getItem(STORAGE_KEY) === "true";
}

export function markOnboardingTourSeen(): void {
  localStorage.setItem(STORAGE_KEY, "true");
}
