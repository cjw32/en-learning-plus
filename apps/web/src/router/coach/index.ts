export default [
  {
    path: '/coach',
    component: () => import('@/layout/index.vue'),
    meta: { requiresAuth: true },
    children: [
      {
        path: 'index',
        name: 'personalized-coach',
        component: () => import('@/views/Coach/index.vue'),
      },
    ],
  },
]
