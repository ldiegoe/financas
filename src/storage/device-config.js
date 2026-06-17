// Storage de "device config" — configurações que valem pro dispositivo todo
// (tema, textSize, prefs de dashboard), espelhadas entre todos os perfis.
// O state.config também tem essas chaves; updateConfig replica em ambos.
// Factory com storage adapter pra ser testável.

// Lista das chaves device-wide. Demais chaves de config ficam por perfil.
export const DEVICE_CONFIG_KEYS = [
  'tema', 'textSize', 'valuesHidden', 'backupReminderDays',
  // Notificações de vencimento (ligar/desligar e quantos dias antes avisar)
  'notifEnabled', 'notifDaysAhead',
  // Cards/gráficos do dashboard
  'dashCompareShow', 'dashBarsShow', 'dashTagShow', 'dashUpcomingShow',
  'dashGoalsShow', 'dashHealthShow', 'dashCollapsed', 'dashOrder',
  'dashInvestShow', 'dashInvestDonutShow', 'dashInvestDonutType',
  'dashInvestDonutInnerPct', 'dashInvestListShow', 'dashInvestListPct',
  'onboardingDone', 'showCategoryIcons',
  // Legacy (fallback): aplicado quando ainda não existem as chaves namespaced
  'dashDonutShow', 'dashDonutType', 'dashDonutInnerPct', 'dashListShow', 'dashListPct',
  // Por gráfico (categoria)
  'dashCatDonutShow', 'dashCatDonutType', 'dashCatDonutInnerPct',
  'dashCatListShow', 'dashCatListPct',
  // Por gráfico (tag) — inclui o modo de contagem multi-tag
  'dashTagDonutShow', 'dashTagDonutType', 'dashTagDonutInnerPct',
  'dashTagListShow', 'dashTagListPct',
  'dashTagSplit',
];

export const createDeviceConfig = ({ storage, key }) => ({
  get() {
    try { return JSON.parse(storage.getItem(key)) || {}; }
    catch { return {}; }
  },
  update(patch) {
    const cur = this.get();
    storage.setItem(key, JSON.stringify({ ...cur, ...patch }));
  },
  // Sobrepõe a config device-wide na config do state recém-carregado pra
  // manter aparência consistente ao trocar de perfil/resetar/importar.
  applyOverlay(state) {
    const dev = this.get();
    for (const k of DEVICE_CONFIG_KEYS) {
      if (dev[k] !== undefined) state.config[k] = dev[k];
    }
    return state;
  },
});
