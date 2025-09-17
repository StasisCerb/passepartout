(function () {
  const MAP_SIZE = 4;
  const RUN_TURN_LIMIT = 40; // ограничение по ходам, чтобы забег укладывался в ~5 минут

  const randomChoice = (list) => list[Math.floor(Math.random() * list.length)];
  const randomInt = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

  const STATUS_LIBRARY = {
    wifiLock: {
      id: 'wifiLock',
      name: 'Глушилка вай-фая',
      description: 'Уменьшает урон противника.',
      onTurn(entity, context) {
        if (context.side === 'enemy') {
          context.damageModifier -= 2;
        }
      }
    },
    burning: {
      id: 'burning',
      name: 'Горение',
      description: 'Получает урон в начале хода.',
      onTick(entity) {
        const burn = 2;
        entity.hp = Math.max(0, entity.hp - burn);
        pushLog(`${entity.name} полыхает и теряет ${burn} HP.`);
      }
    }
  };

  const SKILL_LIBRARY = {
    bottleThrow: {
      id: 'bottleThrow',
      name: 'Бутылка из-под кваса',
      description: 'Классика подворотен: бросок по врагу (5-8 урона).',
      energyCost: 2,
      effect(state) {
        const damage = randomInt(5, 8) + state.player.level;
        applyDamageToEnemy(damage, 'Бутылка из-под кваса');
      }
    },
    wifiScream: {
      id: 'wifiScream',
      name: 'Вай-файный вой',
      description: 'Понижает силу врага на 2 урона на 2 хода.',
      energyCost: 3,
      effect(state) {
        pushLog('Ты издаёшь дисгармоничный вой, блокируя сигналы микрорайона.');
        applyStatus(state.enemy, 'wifiLock', 2);
      }
    },
    fungalInsight: {
      id: 'fungalInsight',
      name: 'Фунгальный инсайт',
      description: 'Пробуждение ленин-гриба внутри. Наносит 4 урона и лечит на 3.',
      energyCost: 4,
      effect(state) {
        pushLog('Ты подключаешься к грибному коллективному разуму.');
        applyDamageToEnemy(4 + state.player.level, 'Фунгальный инсайт');
        healPlayer(3);
      }
    },
    neonDash: {
      id: 'neonDash',
      name: 'Неоновый рывок',
      description: 'Атакует дважды по 4 урона. Открывается на 3 уровне.',
      energyCost: 5,
      unlockedAt: 3,
      effect(state) {
        const total = 4 + state.player.level;
        applyDamageToEnemy(total, 'Первый удар неонового рывка');
        if (state.enemy && state.enemy.hp > 0) {
          applyDamageToEnemy(total, 'Второй удар неонового рывка');
        }
      }
    }
  };

  const ITEM_LIBRARY = {
    tea: {
      id: 'tea',
      name: 'Горячий чай из ларька',
      description: 'Восстанавливает 8 HP.',
      use(state) {
        healPlayer(8);
      }
    },
    mushroomSnack: {
      id: 'mushroomSnack',
      name: 'Сушёный ленин-гриб',
      description: 'Возвращает 4 энергии и даёт 2 опыта.',
      use(state) {
        restoreEnergy(4);
        gainExperience(2, 'Ты хрустишь сушёным ленин-грибом и чувствуешь поток данных.');
      }
    },
    molotov: {
      id: 'molotov',
      name: 'Молотов из Пятёрочки',
      description: 'Поджигает врага на 3 хода.',
      battleOnly: true,
      use(state) {
        if (!state.enemy) {
          pushLog('Поджигать некого. Сохрани бутылку для боя.');
          return false;
        }
        pushLog('Ты чиркаешь спичкой, и район озаряет пламя.');
        applyStatus(state.enemy, 'burning', 3);
        return true;
      }
    }
  };

  const ZONE_ARCHETYPES = [
    {
      type: 'market',
      names: ['Купчино-кластер', 'Лиговский крипторынок', 'Проспект Ломоносова'],
      descriptions: ['Толпа даркнет-курьеров бегает меж контейнеров.', 'Старушки торгуют нейропластырями под прикрытием.', 'Запах синтетического кваса смешан с озоном от серверов.'],
      encounterChance: 0.55,
      lootTable: ['tea', 'mushroomSnack'],
      dialogues: [
        '— Слыхал? Ленин-гриб теперь стримит на подпольном рутюбе.',
        '— Если поймаешь сигнал, передай привет чату «Подпольные дворники».',
        '— Тут говорят, что Смольный уже стал шляпкой, а мы всё бродим.'
      ]
    },
    {
      type: 'metro',
      names: ['Станция «Сквозняк революции»', 'Метро «Мицелий-арена»', 'Переход «Подвал комитета»'],
      descriptions: ['Турникеты заменены биометрическими грибами.', 'Поезда шепчут лозунги цифровым эхом.', 'Надписи на плитке обновляются в режиме реального времени.'],
      encounterChance: 0.65,
      lootTable: ['molotov', 'tea'],
      dialogues: [
        '— Не задерживайся, тут трафик шифруют с задержкой.',
        '— Подполируй свою карму и не забудь улыбнуться камерам-грибам.'
      ]
    },
    {
      type: 'roof',
      names: ['Крышечка на Васильевском', 'Смотровая «Протечка»', 'Небоскрёб «Зарядка модема»'],
      descriptions: ['С высоты видно, как мойки заменены на серверные капсулы.', 'Голуби носят QR-коды вместо перьев.', 'Ветер приносит подкасты с Невы.'],
      encounterChance: 0.35,
      lootTable: ['mushroomSnack'],
      dialogues: [
        '— Внизу кто-то опять устроил рейв «Грибной интернета».',
        '— Говорят, если вслушаться в шум ветра, услышишь посты из прошлого.'
      ]
    },
    {
      type: 'backyard',
      names: ['Двор-колодец «Память модема»', 'Подворотня №404', 'Старый Невский VPN'],
      descriptions: ['Промозглые стены завешаны пиратскими баннерами.', 'Костры из старых смартфонов согревают прохожих.', 'Пахнет парами дешёвой солярки и хмеля.'],
      encounterChance: 0.45,
      lootTable: ['tea', 'molotov'],
      dialogues: [
        '— Вчера на стриме видели, как Ленин-гриб лайкнул попрошайку.',
        '— Здесь раньше был бар, теперь чат-комната под грибным контролем.'
      ]
    }
  ];

  const state = {
    map: [],
    player: null,
    enemy: null,
    mode: 'explore',
    turn: 'player',
    run: {
      max: RUN_TURN_LIMIT,
      remaining: RUN_TURN_LIMIT
    },
    campfireSave: null,
    gameOver: false,
    victory: false
  };

  // DOM references
  const mapEl = document.getElementById('map');
  const statsEl = document.getElementById('stats');
  const statusEffectsEl = document.getElementById('status-effects');
  const actionsEl = document.getElementById('actions');
  const battleEl = document.getElementById('battle');
  const inventoryEl = document.getElementById('inventory');
  const skillsEl = document.getElementById('skills');
  const logEl = document.getElementById('log');
  const dialogueEl = document.getElementById('dialogue');
  const xpBarEl = document.getElementById('xp-bar');
  const runBarEl = document.getElementById('run-bar');

  function initGame() {
    generateMap();
    initPlayer();
    state.mode = 'explore';
    state.gameOver = false;
    state.victory = false;
    state.run.remaining = state.run.max;
    updateUI();
    pushDialogue('Ты', 'Просыпаешься у костра в альтернативном Питере. Мир поглотил Ленин-гриб, а ты пытаешься продержаться хотя бы этот забег.');
  }

  function generateMap() {
    state.map = [];
    for (let y = 0; y < MAP_SIZE; y += 1) {
      const row = [];
      for (let x = 0; x < MAP_SIZE; x += 1) {
        const archetype = randomChoice(ZONE_ARCHETYPES);
        row.push(createZone(archetype, x, y));
      }
      state.map.push(row);
    }

    const campfirePos = { x: Math.floor(MAP_SIZE / 2), y: Math.floor(MAP_SIZE / 2) };
    const campfireZone = state.map[campfirePos.y][campfirePos.x];
    campfireZone.name = 'Костёр у Финляндского вокзала';
    campfireZone.description = 'Здесь греются анонимусы и попрошайки. Можно отдохнуть и сохранить прогресс.';
    campfireZone.isCampfire = true;

    const bossOptions = [];
    state.map.forEach((row, y) => {
      row.forEach((zone, x) => {
        const distance = Math.abs(x - campfirePos.x) + Math.abs(y - campfirePos.y);
        if (distance >= MAP_SIZE - 1) {
          bossOptions.push({ zone, x, y });
        }
      });
    });

    const bossChoice = randomChoice(bossOptions);
    bossChoice.zone.hasBoss = true;
    bossChoice.zone.name = 'Смольный Мицелий';
    bossChoice.zone.description = 'Здесь поселился коллективный разум Ленин-гриба. Победи его, чтобы завершить забег.';
  }

  function createZone(archetype, x, y) {
    const name = randomChoice(archetype.names);
    const description = randomChoice(archetype.descriptions);
    return {
      id: `${x}-${y}`,
      x,
      y,
      type: archetype.type,
      name,
      description,
      encounterChance: archetype.encounterChance,
      lootTable: archetype.lootTable,
      dialogues: archetype.dialogues,
      isCampfire: false,
      hasBoss: false,
      discovered: false
    };
  }

  function initPlayer() {
    state.player = {
      name: 'Безымянный бомж',
      hp: 24,
      maxHp: 24,
      energy: 8,
      maxEnergy: 8,
      level: 1,
      xp: 0,
      nextLevelXp: 12,
      position: { x: Math.floor(MAP_SIZE / 2), y: Math.floor(MAP_SIZE / 2) },
      statuses: [],
      skills: ['bottleThrow', 'wifiScream', 'fungalInsight'],
      inventory: [
        { id: 'tea', quantity: 2 },
        { id: 'mushroomSnack', quantity: 1 },
        { id: 'molotov', quantity: 1 }
      ],
      defense: 1,
      reputation: 0
    };

    saveCampfire();
    revealCurrentZone();
  }

  function revealCurrentZone() {
    const zone = getCurrentZone();
    if (zone && !zone.discovered) {
      zone.discovered = true;
    }
  }

  function getCurrentZone() {
    const { position } = state.player;
    return state.map[position.y][position.x];
  }

  function updateUI() {
    renderMap();
    renderStats();
    renderStatusEffects();
    renderInventory();
    renderSkills();
    renderActions();
    renderBattle();
    updateBars();
  }

  function renderMap() {
    mapEl.innerHTML = '';
    state.map.forEach((row, y) => {
      row.forEach((zone, x) => {
        const tile = document.createElement('div');
        tile.className = 'tile';
        if (state.player.position.x === x && state.player.position.y === y) {
          tile.classList.add('current');
        }
        if (!zone.discovered) {
          tile.classList.add('undiscovered');
        }
        const isReachable = isAdjacent(state.player.position, { x, y });
        if (!isReachable && !(state.player.position.x === x && state.player.position.y === y)) {
          tile.classList.add('disabled');
        }
        tile.innerHTML = `
          <span class="name">${zone.discovered ? zone.name : 'Неизвестно'}</span>
          <span class="tag">${zone.isCampfire ? 'Костёр' : zone.hasBoss ? 'Логово гриба' : zone.type}</span>
        `;
        tile.addEventListener('click', () => {
          if (state.mode !== 'explore') return;
          if (!isReachable) return;
          if (state.player.position.x === x && state.player.position.y === y) {
            describeZone(zone);
          } else {
            movePlayer(x, y);
          }
        });
        mapEl.appendChild(tile);
      });
    });
  }

  function isAdjacent(a, b) {
    const dx = Math.abs(a.x - b.x);
    const dy = Math.abs(a.y - b.y);
    return (dx + dy === 1);
  }

  function describeZone(zone) {
    pushDialogue(zone.name, zone.description);
    if (zone.dialogues.length && Math.random() < 0.6) {
      pushDialogue('Местный', randomChoice(zone.dialogues));
    }
    renderActions();
  }

  function movePlayer(x, y) {
    state.player.position = { x, y };
    revealCurrentZone();
    state.run.remaining = Math.max(0, state.run.remaining - 1);
    pushLog(`Ты перемещаешься в зону «${getCurrentZone().name}».`);
    pushDialogue('Район', getCurrentZone().description);
    if (state.run.remaining <= 0) {
      endRun('Время вышло. Утренний рейд потонул в тумане Невы.');
      return;
    }
    checkZoneEvents();
    updateUI();
  }

  function checkZoneEvents() {
    const zone = getCurrentZone();
    if (zone.hasBoss) {
      pushDialogue('Смольный Мицелий', 'Ты дошёл до центра грибного интернета. Докажи, что способен прорваться.');
      startBattle(zone, { boss: true });
      return;
    }

    if (zone.isCampfire) {
      pushDialogue('Костровой', 'Костёр трещит, предлагая тепло и временное убежище.');
    }

    if (Math.random() < zone.encounterChance) {
      startBattle(zone, { boss: false });
    } else if (Math.random() < 0.4) {
      triggerExplorationEvent(zone);
    }
  }

  function triggerExplorationEvent(zone) {
    const roll = Math.random();
    if (roll < 0.4) {
      const loot = randomChoice(zone.lootTable);
      addItemToInventory(loot, 1);
      pushLog(`Ты находишь ${ITEM_LIBRARY[loot].name}.`);
    } else if (roll < 0.7) {
      gainExperience(3, 'Ты подслушиваешь разговор подпольного чата и извлекаешь полезные инсайды.');
    } else {
      state.player.reputation += 1;
      pushDialogue('Диджей с помойки', 'Подкинул тебе звук из нижнего интернета. Репутация выросла.');
    }
  }

  function startBattle(zone, { boss }) {
    state.mode = 'battle';
    state.enemy = createEnemy(zone, boss);
    state.turn = 'player';
    pushLog(`Враг ${state.enemy.name} выходит на бой!`);
    updateUI();
  }

  function createEnemy(zone, boss = false) {
    if (boss) {
      return {
        id: 'boss',
        name: 'Коллективный Ленин-гриб',
        hp: 36,
        maxHp: 36,
        attack: 7,
        level: 3,
        statuses: [],
        dialogues: [
          '— Живи, бродяга, и подключайся к нашему корневому каналу.',
          '— Народный интернет победит, даже если пахнет мочой.'
        ]
      };
    }

    const templateNames = [
      'Фантом чат-бота',
      'Уличный модемщик',
      'Грибной лектор',
      'Собака-агрегатор'
    ];
    const enemy = {
      id: `enemy-${Date.now()}`,
      name: randomChoice(templateNames),
      hp: randomInt(12, 18),
      maxHp: 0,
      attack: randomInt(3, 5),
      level: randomInt(1, 2),
      statuses: [],
      dialogues: [
        '— Отдай доступ к своим кешам!',
        '— Ты не пройдёшь дальше без подписки.',
        '— Ленин-гриб любит таких, как ты.'
      ]
    };
    enemy.maxHp = enemy.hp;
    pushDialogue(enemy.name, randomChoice(enemy.dialogues));
    return enemy;
  }

  function applyStatus(target, statusId, duration) {
    const status = STATUS_LIBRARY[statusId];
    if (!status) return;
    const existing = target.statuses.find((s) => s.id === statusId);
    if (existing) {
      existing.duration = Math.max(existing.duration, duration);
    } else {
      target.statuses.push({ id: statusId, duration });
    }
    const entityName = target === state.player ? 'Ты' : target.name;
    pushLog(`${entityName} получает эффект: ${status.name}.`);
    updateStatusEffects();
    renderBattle();
  }

  function healPlayer(amount) {
    const prev = state.player.hp;
    state.player.hp = clamp(state.player.hp + amount, 0, state.player.maxHp);
    pushLog(`Ты восстанавливаешь ${state.player.hp - prev} HP.`);
    updateUI();
  }

  function restoreEnergy(amount) {
    const prev = state.player.energy;
    state.player.energy = clamp(state.player.energy + amount, 0, state.player.maxEnergy);
    pushLog(`Энергия +${state.player.energy - prev}.`);
    updateUI();
  }

  function applyDamageToEnemy(amount, source) {
    if (!state.enemy) return;
    const effective = Math.max(0, amount);
    state.enemy.hp = Math.max(0, state.enemy.hp - effective);
    pushLog(`${source} наносит ${effective} урона (${state.enemy.name}).`);
    if (state.enemy.hp <= 0) {
      concludeBattle(true);
    } else {
      renderBattle();
    }
  }

  function takePlayerDamage(amount) {
    const effective = Math.max(0, amount - state.player.defense);
    state.player.hp = Math.max(0, state.player.hp - effective);
    pushLog(`Ты получаешь ${effective} урона.`);
    if (state.player.hp <= 0) {
      handlePlayerDeath();
    }
    updateUI();
  }

  function pushLog(message) {
    const entry = document.createElement('div');
    entry.className = 'log-entry';
    entry.textContent = message;
    logEl.prepend(entry);
    const limit = 80;
    while (logEl.childNodes.length > limit) {
      logEl.removeChild(logEl.lastChild);
    }
  }

  function pushDialogue(speaker, text) {
    const paragraph = document.createElement('p');
    paragraph.innerHTML = `<span class="speaker">${speaker}:</span> ${text}`;
    dialogueEl.prepend(paragraph);
    const limit = 20;
    while (dialogueEl.childNodes.length > limit) {
      dialogueEl.removeChild(dialogueEl.lastChild);
    }
  }

  function renderStats() {
    const { player } = state;
    statsEl.innerHTML = '';
    const stats = [
      { label: 'Здоровье', value: `${player.hp}/${player.maxHp}` },
      { label: 'Энергия', value: `${player.energy}/${player.maxEnergy}` },
      { label: 'Уровень', value: player.level },
      { label: 'Опыт', value: `${player.xp}/${player.nextLevelXp}` },
      { label: 'Защита', value: player.defense },
      { label: 'Репутация', value: player.reputation }
    ];
    stats.forEach((stat) => {
      const element = document.createElement('div');
      element.className = 'stat';
      element.innerHTML = `<label>${stat.label}</label><span>${stat.value}</span>`;
      statsEl.appendChild(element);
    });
  }

  function renderStatusEffects() {
    statusEffectsEl.innerHTML = '';
    const playerStatuses = state.player.statuses.map((status) => STATUS_LIBRARY[status.id]);
    if (!playerStatuses.length) {
      const badge = document.createElement('span');
      badge.className = 'badge';
      badge.textContent = 'Нет эффектов';
      statusEffectsEl.appendChild(badge);
      return;
    }
    playerStatuses.forEach((status) => {
      const badge = document.createElement('span');
      badge.className = 'badge';
      badge.textContent = status.name;
      statusEffectsEl.appendChild(badge);
    });
  }

  function renderActions() {
    actionsEl.innerHTML = '';
    if (state.gameOver) {
      const restartBtn = createButton('Начать заново', initGame);
      actionsEl.appendChild(restartBtn);
      return;
    }

    if (state.mode === 'battle') {
      const info = document.createElement('div');
      info.textContent = 'В бою: выбирай скиллы или предметы.';
      actionsEl.appendChild(info);
      return;
    }

    const zone = getCurrentZone();
    const describeBtn = createButton('Осмотреться', () => describeZone(zone));
    actionsEl.appendChild(describeBtn);

    if (zone.isCampfire) {
      const restBtn = createButton('Отдохнуть', () => {
        healPlayer(state.player.maxHp);
        restoreEnergy(state.player.maxEnergy);
        pushDialogue('Костровой', 'Пока ты спал, кто-то накинул тебе на плечи плед из старых баннеров.');
      });
      const saveBtn = createButton('Сохраниться у костра', () => {
        saveCampfire();
        pushLog('Состояние сохранено. Если погибнешь, вернёшься к этому костру.');
      });
      const chatBtn = createButton('Поговорить с анонимусом', () => {
        const lines = [
          '— Если увидишь Ленин-гриб, спроси у него пароль от подвала.',
          '— Мы все в одной лодке, которая давно проржавела.',
          '— Нижний интернет не прощает тех, кто забывает своих.'
        ];
        pushDialogue('Анонимус', randomChoice(lines));
      });
      actionsEl.append(restBtn, saveBtn, chatBtn);
    }

    if (!state.victory) {
      const endBtn = createButton('Сдаться и завершить забег', () => {
        endRun('Ты покидаешь улицы, оставив Ленин-грибу победу в этот раз.');
      });
      actionsEl.appendChild(endBtn);
    } else {
      const restartBtn = createButton('Запустить новый забег', initGame);
      actionsEl.appendChild(restartBtn);
    }
  }

  function renderBattle() {
    battleEl.innerHTML = '';
    if (state.mode !== 'battle' || !state.enemy) {
      return;
    }

    const enemyInfo = document.createElement('div');
    enemyInfo.className = 'battle-info';
    enemyInfo.innerHTML = `
      <h3>${state.enemy.name}</h3>
      <p>HP: ${state.enemy.hp}/${state.enemy.maxHp || state.enemy.hp}</p>
      <p>Атака: ${state.enemy.attack}</p>
    `;
    battleEl.appendChild(enemyInfo);

    const actionHint = document.createElement('p');
    actionHint.textContent = state.turn === 'player' ? 'Твой ход. Выбери скилл или предмет.' : 'Ход врага...';
    battleEl.appendChild(actionHint);

    if (state.turn === 'player') {
      renderSkills(true);
      renderInventory(true);
    }
  }

  function renderInventory(forBattle = false) {
    if (!forBattle) {
      inventoryEl.innerHTML = '';
    }
    const container = forBattle ? battleEl : inventoryEl;
    const wrapper = document.createElement('div');
    wrapper.className = 'inventory-wrapper';

    if (!state.player.inventory.length) {
      const empty = document.createElement('div');
      empty.textContent = 'Пусто.';
      wrapper.appendChild(empty);
      container.appendChild(wrapper);
      return;
    }

    state.player.inventory.forEach((slot) => {
      const itemDef = ITEM_LIBRARY[slot.id];
      if (!itemDef) return;
      const itemEl = document.createElement('div');
      itemEl.className = 'item';
      itemEl.innerHTML = `
        <div class="item-details">
          <span>${itemDef.name} ×${slot.quantity}</span>
          <span class="muted">${itemDef.description}</span>
        </div>
      `;
      const useBtn = createButton('Использовать', () => {
        if (state.mode === 'battle' && itemDef.battleOnly === false) {
          pushLog('Этот предмет нельзя применять в бою.');
          return;
        }
        if (itemDef.battleOnly && state.mode !== 'battle') {
          pushLog('Этот предмет работает только в бою.');
          return;
        }
        const result = itemDef.use(state);
        if (result === false) return;
        slot.quantity -= 1;
        if (slot.quantity <= 0) {
          state.player.inventory = state.player.inventory.filter((i) => i.quantity > 0);
        }
        updateUI();
        if (state.mode === 'battle' && state.enemy && state.enemy.hp > 0 && state.turn === 'player') {
          endPlayerTurn();
        }
      });
      itemEl.appendChild(useBtn);
      wrapper.appendChild(itemEl);
    });

    container.appendChild(wrapper);
  }

  function renderSkills(forBattle = false) {
    if (!forBattle) {
      skillsEl.innerHTML = '';
    }
    const container = forBattle ? battleEl : skillsEl;
    const wrapper = document.createElement('div');
    wrapper.className = 'skills-wrapper';

    const availableSkills = state.player.skills
      .map((id) => SKILL_LIBRARY[id])
      .filter((skill) => skill && (!skill.unlockedAt || state.player.level >= skill.unlockedAt));

    availableSkills.forEach((skill) => {
      const skillEl = document.createElement('div');
      skillEl.className = 'skill';
      skillEl.innerHTML = `
        <div class="skill-details">
          <span>${skill.name}</span>
          <span class="muted">${skill.description}</span>
        </div>
      `;
      if (forBattle) {
        const btn = createButton(`Каст (${skill.energyCost})`, () => useSkill(skill));
        if (state.player.energy < skill.energyCost) {
          btn.disabled = true;
        }
        skillEl.appendChild(btn);
      }
      wrapper.appendChild(skillEl);
    });

    container.appendChild(wrapper);
  }

  function useSkill(skillDef) {
    if (state.turn !== 'player') return;
    if (state.player.energy < skillDef.energyCost) {
      pushLog('Недостаточно энергии.');
      return;
    }
    state.player.energy -= skillDef.energyCost;
    skillDef.effect(state);
    updateUI();
    if (state.enemy && state.enemy.hp > 0) {
      endPlayerTurn();
    }
  }

  function endPlayerTurn() {
    state.turn = 'enemy';
    renderBattle();
    setTimeout(enemyTurn, 600);
  }

  function enemyTurn() {
    if (!state.enemy) return;
    tickStatuses(state.enemy, 'enemy');
    if (state.enemy.hp <= 0) return;

    const context = { side: 'enemy', damageModifier: 0 };
    state.enemy.statuses.forEach((status) => {
      const def = STATUS_LIBRARY[status.id];
      if (def && def.onTurn) {
        def.onTurn(state.enemy, context);
      }
    });

    let damage = state.enemy.attack + randomInt(0, 2) + context.damageModifier;
    damage = Math.max(0, damage);

    pushLog(`${state.enemy.name} атакует.`);
    takePlayerDamage(damage);

    if (state.player.hp > 0) {
      endEnemyTurn();
    }
  }

  function endEnemyTurn() {
    state.turn = 'player';
    tickStatuses(state.player, 'player');
    renderBattle();
  }

  function tickStatuses(entity, side) {
    entity.statuses = entity.statuses.filter((status) => {
      const def = STATUS_LIBRARY[status.id];
      if (!def) return false;
      if (def.onTick) {
        def.onTick(entity);
        if (entity === state.player && state.player.hp <= 0) {
          handlePlayerDeath();
        } else if (entity === state.enemy && state.enemy.hp <= 0) {
          concludeBattle(true);
          return false;
        }
      }
      if (def.onTurn) {
        def.onTurn(entity, { side, damageModifier: 0 });
      }
      status.duration -= 1;
      return status.duration > 0;
    });
    updateStatusEffects();
  }

  function concludeBattle(playerWon) {
    if (playerWon) {
      const xpGain = 6 + state.enemy.level * 2;
      pushLog(`Ты побеждаешь ${state.enemy.name} и получаешь ${xpGain} опыта.`);
      gainExperience(xpGain);
      maybeDropLoot(state.enemy);
      if (state.enemy.id === 'boss') {
        state.victory = true;
        endRun('Ты победил коллективный Ленин-гриб! Нижний интернет свободен (на сегодня).');
      }
    } else {
      pushLog('Враг уходит, оставляя тебя в пыли.');
    }

    state.enemy = null;
    state.mode = state.gameOver ? 'ended' : 'explore';
    state.turn = 'player';
    renderBattle();
    updateUI();
  }

  function maybeDropLoot(enemy) {
    if (!enemy || enemy.id === 'boss') {
      addItemToInventory('molotov', 1);
      pushLog('Победа дарит тебе ещё один коктейль Молотова.');
      return;
    }
    if (Math.random() < 0.5) {
      const loot = randomChoice(['tea', 'mushroomSnack']);
      addItemToInventory(loot, 1);
      pushLog(`С ${enemy.name} выпадает ${ITEM_LIBRARY[loot].name}.`);
    }
  }

  function addItemToInventory(id, quantity) {
    const slot = state.player.inventory.find((item) => item.id === id);
    if (slot) {
      slot.quantity += quantity;
    } else {
      state.player.inventory.push({ id, quantity });
    }
    updateUI();
  }

  function gainExperience(amount, message) {
    state.player.xp += amount;
    if (message) pushLog(message);
    pushLog(`Опыт +${amount}.`);
    while (state.player.xp >= state.player.nextLevelXp) {
      levelUp();
    }
    updateUI();
  }

  function levelUp() {
    const overflow = state.player.xp - state.player.nextLevelXp;
    state.player.level += 1;
    state.player.nextLevelXp += 6;
    state.player.xp = Math.max(0, overflow);
    state.player.maxHp += 4;
    state.player.maxEnergy += 2;
    state.player.hp = state.player.maxHp;
    state.player.energy = state.player.maxEnergy;
    state.player.defense += 1;
    pushLog(`Ты повышаешься до ${state.player.level} уровня!`);
    if (!state.player.skills.includes('neonDash')) {
      state.player.skills.push('neonDash');
      pushDialogue('Вспышка сознания', 'Ты вспоминаешь технику «Неоновый рывок». Теперь её можно применять в бою.');
    }
    if (state.player.xp >= state.player.nextLevelXp) {
      levelUp();
    }
  }

  function handlePlayerDeath() {
    pushLog('Ты пал в бою. Ленин-гриб смеётся в подвале интернета.');
    if (state.campfireSave) {
      pushLog('Смерть не конец — ты возвращаешься к последнему костру.');
      loadCampfire();
    } else {
      endRun('Ты погиб без сохранения. Забег окончен.');
    }
  }

  function saveCampfire() {
    state.campfireSave = {
      position: { ...state.player.position },
      player: {
        hp: state.player.hp,
        maxHp: state.player.maxHp,
        energy: state.player.energy,
        maxEnergy: state.player.maxEnergy,
        level: state.player.level,
        xp: state.player.xp,
        nextLevelXp: state.player.nextLevelXp,
        defense: state.player.defense,
        reputation: state.player.reputation,
        statuses: state.player.statuses.map((s) => ({ ...s })),
        skills: [...state.player.skills],
        inventory: state.player.inventory.map((slot) => ({ ...slot }))
      },
      runRemaining: state.run.remaining
    };
  }

  function loadCampfire() {
    if (!state.campfireSave) return;
    const snapshot = state.campfireSave;
    state.player.position = { ...snapshot.position };
    state.player.hp = snapshot.player.hp;
    state.player.maxHp = snapshot.player.maxHp;
    state.player.energy = snapshot.player.energy;
    state.player.maxEnergy = snapshot.player.maxEnergy;
    state.player.level = snapshot.player.level;
    state.player.xp = snapshot.player.xp;
    state.player.nextLevelXp = snapshot.player.nextLevelXp;
    state.player.defense = snapshot.player.defense;
    state.player.reputation = snapshot.player.reputation;
    state.player.statuses = snapshot.player.statuses.map((s) => ({ ...s }));
    state.player.skills = [...snapshot.player.skills];
    state.player.inventory = snapshot.player.inventory.map((slot) => ({ ...slot }));
    state.run.remaining = snapshot.runRemaining;
    state.mode = 'explore';
    state.enemy = null;
    revealCurrentZone();
    updateUI();
    pushDialogue('Костёр', 'Пламя обжигает тебя, возвращая к жизни.');
  }

  function endRun(reason) {
    state.gameOver = true;
    state.mode = 'ended';
    pushLog(reason);
    renderActions();
    renderBattle();
  }

  function updateBars() {
    const xpPercent = Math.min(100, (state.player.xp / state.player.nextLevelXp) * 100);
    xpBarEl.style.width = `${xpPercent}%`;
    const runPercent = Math.min(100, (state.run.remaining / state.run.max) * 100);
    runBarEl.style.width = `${runPercent}%`;
  }

  function createButton(label, handler) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = label;
    button.addEventListener('click', handler);
    return button;
  }

  function updateStatusEffects() {
    renderStatusEffects();
  }

  document.addEventListener('DOMContentLoaded', initGame);
})();
