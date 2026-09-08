export const config = {
    ports:{
        server:3000,
        ai:3001,
        web:8080
    }
}

export const coachConfigKeys = [
    'COACH_ENABLED',
    'COACH_LIVE_MODEL_ENABLED',
    'COACH_WRITE_ENABLED',
    'COACH_MODEL_NAME',
    'COACH_MODEL_VERSION',
    'COACH_MODEL_PRICE_VERSION',
    'COACH_BUDGET_POLICY_VERSION',
    'COACH_EVAL_DATASET_VERSION',
] as const
