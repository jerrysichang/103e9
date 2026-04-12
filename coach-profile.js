/**
 * Coach Profile — local + Firebase sync for the user's life context.
 *
 * Profile lives in localStorage (fast reads) and syncs to the Firebase vault
 * using setDoc with merge: true so it never overwrites gratitude data.
 */

import { syncProfileToCloud } from './firebase-sync.js'

const PROFILE_KEY = 'ps_profile_v1'

const DEFAULT_PROFILE = {
  location:            '',
  life_stage:          '',
  relationship_status: '',
  planning_horizon:    '',
  net_worth_approx:    '',
  savings_rate:        '',
  savings_rate_target: '',
  financial_goals:     '',
  financial_notes:     '',
  active_training_goal: '',
  key_metrics:         {},
  nutrition_approach:  '',
  health_notes:        '',
  current_role:        '',
  career_model:        '',
  side_projects:       [],
  key_frameworks:      '',
  career_notes:        '',
  active_goals:        [],
  fixed_deadlines:     [],
  open_questions:      '',
  additional_context:  '',
  updated_at:          null,
}

/**
 * Returns the profile object, merging stored data over defaults.
 * @returns {Object}
 */
export function getProfile() {
  try {
    const raw = localStorage.getItem(PROFILE_KEY)
    return raw ? { ...DEFAULT_PROFILE, ...JSON.parse(raw) } : { ...DEFAULT_PROFILE }
  } catch {
    return { ...DEFAULT_PROFILE }
  }
}

/**
 * Writes profile to localStorage and syncs to Firebase vault.
 * @param {Object} profile
 */
export async function saveProfile(profile) {
  localStorage.setItem(PROFILE_KEY, JSON.stringify(profile))
  await syncProfileToCloud(profile)
}

/**
 * Merges updates into the existing profile and saves.
 * Always stamps updated_at.
 * @param {Object} updates - partial profile fields that changed
 * @returns {Object} updated profile
 */
export async function patchProfile(updates) {
  const current = getProfile()
  const updated = { ...current, ...updates, updated_at: new Date().toISOString() }
  await saveProfile(updated)
  return updated
}
