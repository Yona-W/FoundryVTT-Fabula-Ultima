import { isActiveEffectForStatusEffectId, onManageActiveEffect, prepareActiveEffectCategories, toggleStatusEffect } from '../helpers/effects.mjs';
import { createChatMessage, promptCheck, promptOpenCheck } from '../helpers/checks.mjs';
import { actionHandler } from '../helpers/action-handler.mjs';
import { GroupCheck } from '../helpers/group-check.mjs';
// import { OpposedCheck } from '../helpers/opposed-check.mjs';
import { handleStudyRoll } from '../helpers/study-roll.mjs';
import { SETTINGS } from '../settings.js';
import { FU, SYSTEM } from '../helpers/config.mjs';
import { FUActor } from '../documents/actors/actor.mjs';

const TOGGLEABLE_STATUS_EFFECT_IDS = ['crisis', 'slow', 'dazed', 'enraged', 'dex-up', 'mig-up', 'ins-up', 'wlp-up', 'guard', 'weak', 'shaken', 'poisoned', 'dex-down', 'mig-down', 'ins-down', 'wlp-down'];

/**
 * Extend the basic ActorSheet with some very simple modifications
 * @extends {ActorSheet}
 */
export class FUStandardActorSheet extends ActorSheet {
	/** @override */
	static get defaultOptions() {
		return foundry.utils.mergeObject(super.defaultOptions, {
			classes: ['projectfu', 'sheet', 'actor', 'backgroundstyle'],
			template: 'systems/projectfu/templates/actor/actor-character-sheet.hbs',
			width: 750,
			height: 1000,
			tabs: [
				{
					navSelector: '.sheet-tabs',
					contentSelector: '.sheet-body',
					initial: 'stats',
				},
			],
			scrollY: ['.sheet-body'],
		});
	}

	/** @override */
	get template() {
		return `systems/projectfu/templates/actor/actor-${this.actor.type}-sheet.hbs`;
	}

	/* -------------------------------------------- */

	/** @override */
	async getData() {
		// Retrieve the data structure from the base sheet. You can inspect or log
		// the context variable to see the structure, but some key properties for
		// sheets are the actor object, the data object, whether or not it's
		// editable, the items array, and the effects array.
		const context = super.getData();

		// Use a safe clone of the actor data for further operations.
		const actorData = this.actor;

		// Add the actor's data to context.data for easier access, as well as flags.
		context.system = actorData.system;
		context.flags = actorData.flags;

		await this._prepareItems(context);
		this._prepareCharacterData(context);
		// Initialize the _expanded set as a local variable within the object or class
		this._expanded = new Set();
		// Prepare character data and items.
		if (actorData.type === 'character') {
			context.tlTracker = this.actor.tlTracker;
		}

		// Prepare NPC data and items.
		if (actorData.type === 'npc') {
			context.spTracker = this.actor.spTracker;
		}

		context.statusEffectToggles = [];
		// Setup status effect toggle data
		for (const id of TOGGLEABLE_STATUS_EFFECT_IDS) {
			const statusEffect = CONFIG.statusEffects.find((e) => e.id === id);
			if (statusEffect) {
				const existing = this.actor.effects.some((e) => isActiveEffectForStatusEffectId(e, statusEffect.id));
				context.statusEffectToggles.push({ ...statusEffect, active: existing });
			}
		}

		// Sort the items array in-place based on the current sorting method
		if (this.sortMethod === 'name') {
			context.items.sort((a, b) => {
				const nameA = a.name.toUpperCase();
				const nameB = b.name.toUpperCase();
				return this.sortOrder * nameA.localeCompare(nameB);
			});
		} else if (this.sortMethod === 'type') {
			context.items.sort((a, b) => {
				const typeA = a.type.toUpperCase();
				const typeB = b.type.toUpperCase();
				return this.sortOrder * typeA.localeCompare(typeB);
			});
		} else {
			// Default sorting by 'sort' property
			context.items.sort((a, b) => this.sortOrder * (a.sort || 0) - this.sortOrder * (b.sort || 0));
		}

		// Add roll data for TinyMCE editors.
		context.rollData = context.actor.getRollData();

		// Prepare active effects
		context.effects = prepareActiveEffectCategories(game.release.generation >= 11 ? Array.from(this.actor.allApplicableEffects()) : this.actor.effects);

		// Add the actor object to context for easier access
		context.actor = actorData;

		context.enrichedHtml = {
			description: await TextEditor.enrichHTML(context.system.description ?? ''),
		};

		const studyRollTiers = game.settings.get(SYSTEM, SETTINGS.useRevisedStudyRule) ? FU.studyRoll.revised : FU.studyRoll.core;
		let studyRoll;
		studyRoll = studyRollTiers.map((value) => value + '+');
		studyRoll.unshift('-');
		studyRoll = studyRoll.reduce((agg, curr, idx) => (agg[idx] = curr) && agg, {});

		context.studyRoll = studyRoll;

		context.FU = FU;

		return context;
	}

	/**
	 * Organize and classify Items for Character sheets.
	 *
	 * @param {Object} actorData The actor to prepare.
	 *
	 * @return {undefined}
	 */
	_prepareCharacterData(context) {
		if (!context || !context.system || !context.system.attributes || !context.system.affinities) {
			console.error('Invalid context or context.system');
			return;
		}

		// Handle ability scores.
		for (let [k, v] of Object.entries(context.system.attributes)) {
			v.label = game.i18n.localize(CONFIG.FU.attributes[k]) ?? k;
			v.abbr = game.i18n.localize(CONFIG.FU.attributeAbbreviations[k]) ?? k;
		}

		// Handle affinity
		for (let [k, v] of Object.entries(context.system.affinities)) {
			v.label = game.i18n.localize(CONFIG.FU.damageTypes[k]) ?? k;
			v.affTypeBase = game.i18n.localize(CONFIG.FU.affType[v.base]) ?? v.base;
			v.affTypeBaseAbbr = game.i18n.localize(CONFIG.FU.affTypeAbbr[v.base]) ?? v.base;
			v.affTypeCurr = game.i18n.localize(CONFIG.FU.affType[v.current]) ?? v.current;
			v.affTypeCurrAbbr = game.i18n.localize(CONFIG.FU.affTypeAbbr[v.current]) ?? v.current;
			v.icon = CONFIG.FU.affIcon[k];
		}

		// Handle item types
	}

	/**
	 * Organize and classify Items for Character sheets.
	 *
	 * @param {Object} actorData The actor to prepare.
	 *
	 * @return {undefined}
	 */
	async _prepareItems(context) {
		// Initialize containers.
		const basics = [];
		const weapons = [];
		const armor = [];
		const shields = [];
		const accessories = [];
		const classes = [];
		const skills = [];
		const heroics = [];
		const spells = [];
		const abilities = [];
		const rules = [];
		const behaviors = [];
		const consumables = [];
		const treasures = [];
		const projects = [];
		const rituals = [];
		const zeroPowers = [];

		// Iterate through items, allocating to containers
		for (let i of context.items) {
			i.img = i.img || CONST.DEFAULT_TOKEN;

			if (i.system.quality?.value) {
				i.quality = i.system.quality.value;
			}

			i.isMartial = i.system.isMartial?.value ? true : false;
			i.isOffensive = i.system.isOffensive?.value ? true : false;
			i.isBehavior = i.system.isBehavior?.value ? true : false;
			i.equipped = i.system.isEquipped?.value ? true : false;
			i.equippedSlot = i.system.isEquipped && i.system.isEquipped.slot ? true : false;
			i.level = i.system.level?.value;
			i.class = i.system.class?.value;
			i.mpCost = i.system.mpCost?.value;
			i.target = i.system.target?.value;
			i.duration = i.system.duration?.value;
			i.dLevel = i.system.dLevel?.value;
			i.clock = i.system.clock?.value;
			i.progressPerDay = i.system.progressPerDay?.value;
			i.days = i.system.days?.value;
			i.cost = i.system.cost?.value;
			i.discount = i.system.discount?.value;
			i.potency = i.system.potency?.value;
			i.area = i.system.area?.value;
			i.use = i.system.use?.value;
			i.defect = i.system.isDefect?.value ? true : false;
			i.defectMod = i.system.use?.value;
			i.zeroTrigger = i.system.zeroTrigger?.value;
			i.zeroEffect = i.system.zeroEffect?.value;
			i.progressCurr = i.system.progress?.current;
			i.progressStep = i.system.progress?.step;
			i.progressMax = i.system.progress?.max;

			// Clocks
			for (let item of context.items) {
				const relevantTypes = ['zeroPower', 'ritual', 'miscAbility', 'rule'];

				if (relevantTypes.includes(item.type)) {
					const progressArr = [];
					const progress = item.system.progress || { current: 0, max: 6 };

					for (let i = 0; i < progress.max; i++) {
						progressArr.push({
							id: i + 1,
							checked: parseInt(progress.current) === i + 1,
						});
					}

					// TODO: On progress max display a custom button over clock to activate item's effect
					// if (progress.current === progress.max) {
					// 	let maxTitle = `${item.name} MAX!`;
					// 	let maxDescription = '';

					// 	if (item.type === 'zeroPower') {
					// 		maxDescription = `Trigger: ${item.system.zeroTrigger?.description || ''}<br>Effect: ${item.system.zeroEffect?.description || ''}`;
					// 	} else {
					// 		maxDescription = item.system.description || '';
					// 	}

					// 	const params = {
					// 		details: { name: maxTitle },
					// 		description: maxDescription,
					// 		speaker: ChatMessage.getSpeaker({ actor: this.actor }),
					// 	};
					// 	createChatMessage(params);
					// }

					item.progressArr = progressArr.reverse();
				}
			}

			// Resource Points
			for (let item of context.items) {
				const relevantTypes = ['miscAbility', 'skill', 'heroic'];

				if (relevantTypes.includes(item.type)) {
					const rpArr = [];
					const rp = item.system.rp || { current: 0, max: 6 };

					for (let i = 0; i < rp.max; i++) {
						rpArr.push({
							id: i + 1,
							checked: parseInt(rp.current) === i + 1,
						});
					}

					item.rpArr = rpArr.reverse();
				}
			}

			// SL Stars
			for (let item of context.items) {
				if (item.type === 'skill') {
					const skillArr = [];
					const level = item.system.level || { value: 0, max: 8 };

					for (let i = 0; i < level.max; i++) {
						skillArr.push({
							id: i + 1,
							checked: parseInt(level.value) === i + 1,
						});
					}

					item.skillArr = skillArr;
				}
			}

			// Enriches description fields for each item within the context.items array
			for (let item of context.items) {
				item.enrichedHtml = {
					description: await TextEditor.enrichHTML(item.system?.description ?? ''),
					zeroTrigger: await TextEditor.enrichHTML(item.system?.zeroTrigger?.description ?? ''),
					zeroEffect: await TextEditor.enrichHTML(item.system?.zeroEffect?.description ?? ''),
				};
			}

			if (['armor', 'shield', 'accessory'].includes(i.type)) {
				i.def = i.isMartial && i.type === 'armor' ? i.system.def.value : `+${i.system.def.value}`;
				i.mdef = `+${i.system.mdef.value}`;
				i.init = i.system.init.value > 0 ? `+${i.system.init.value}` : i.system.init.value;
			}
			if (i.type === 'basic') {
				const itemObj = context.actor.items.get(i._id);
				const weapData = itemObj.getWeaponDisplayData(this.actor);
				i.quality = weapData.qualityString;
				i.detail = weapData.detailString;
				i.attackString = weapData.attackString;
				i.damageString = weapData.damageString;
				basics.push(i);
			} else if (i.type === 'weapon') {
				const itemObj = context.actor.items.get(i._id);
				const weapData = itemObj.getWeaponDisplayData(this.actor);
				i.quality = weapData.qualityString;
				i.detail = weapData.detailString;
				i.attackString = weapData.attackString;
				i.damageString = weapData.damageString;
				weapons.push(i);
			} else if (i.type === 'armor') {
				armor.push(i);
			} else if (i.type === 'shield') {
				const itemObj = context.actor.items.get(i._id);
				const weapData = itemObj.getWeaponDisplayData(this.actor);
				i.quality = weapData.qualityString;
				i.detail = weapData.detailString;
				i.attackString = weapData.attackString;
				i.damageString = weapData.damageString;
				shields.push(i);
			} else if (i.type === 'accessory') {
				accessories.push(i);
			} else if (i.type === 'class') {
				classes.push(i);
			} else if (i.type === 'skill') {
				const itemObj = context.actor.items.get(i._id);
				const skillData = itemObj.getSkillDisplayData();
				i.quality = skillData.qualityString;
				skills.push(i);
			} else if (i.type === 'heroic') {
				heroics.push(i);
			} else if (i.type === 'spell') {
				const itemObj = context.actor.items.get(i._id);
				const spellData = itemObj.getSpellDisplayData(this.actor);
				i.quality = spellData.qualityString;
				i.detail = spellData.detailString;
				i.attackString = spellData.attackString;
				i.damageString = spellData.damageString;
				spells.push(i);
			} else if (i.type === 'miscAbility') {
				const itemObj = context.actor.items.get(i._id);
				const skillData = itemObj.getSkillDisplayData();
				i.quality = skillData.qualityString;
				abilities.push(i);
			} else if (i.type === 'rule') {
				rules.push(i);
			} else if (i.type === 'behavior') {
				behaviors.push(i);
			} else if (i.type === 'consumable') {
				const itemObj = context.actor.items.get(i._id);
				const itemData = itemObj.getItemDisplayData();
				i.quality = itemData.qualityString;
				consumables.push(i);
			} else if (i.type === 'treasure') {
				const itemObj = context.actor.items.get(i._id);
				const itemData = itemObj.getItemDisplayData();
				i.quality = itemData.qualityString;
				treasures.push(i);
			} else if (i.type === 'project') {
				projects.push(i);
			} else if (i.type === 'ritual') {
				rituals.push(i);
			} else if (i.type === 'zeroPower') {
				zeroPowers.push(i);
			}
		}

		// Assign and return
		context.basics = basics;
		context.weapons = weapons;
		context.armor = armor;
		context.shields = shields;
		context.accessories = accessories;
		context.classes = classes;
		context.skills = skills;
		context.heroics = heroics;
		context.spells = spells;
		context.abilities = abilities;
		context.rules = rules;
		context.behaviors = behaviors;
		context.consumables = consumables;
		context.treasures = treasures;
		context.projects = projects;
		context.rituals = rituals;
		context.zeroPowers = zeroPowers;
		context.classFeatures = {};
		for (const item of this.actor.itemTypes.classFeature) {
			const featureType = (context.classFeatures[item.system.featureType] ??= {
				feature: item.system.data?.constructor,
				items: {},
			});
			featureType.items[item.id] = { item, additionalData: await featureType.feature?.getAdditionalData(item.system.data) };
		}

		context.optionalFeatures = {};
		for (const item of this.actor.itemTypes.optionalFeature) {
			const optionalType = (context.optionalFeatures[item.system.optionalType] ??= {
				optional: item.system.data?.constructor,
				items: {},
			});
			optionalType.items[item.id] = { item, additionalData: await optionalType.optional?.getAdditionalData(item.system.data) };

			// Feature Clocks
			const relevantTypes = ['optionalFeature'];

			if (relevantTypes.includes(item.type)) {
				const progressArr = [];
				const progress = item.system.data.progress || { current: 0, max: 6 };

				for (let i = 0; i < progress.max; i++) {
					progressArr.push({
						id: i + 1,
						checked: parseInt(progress.current) === i + 1,
					});
				}

				item.progressArr = progressArr.reverse();
			}
		}
	}

	/* -------------------------------------------- */

	/** @override */
	activateListeners(html) {
		super.activateListeners(html);

		// Render the item sheet for viewing/editing prior to the editable check.
		html.find('.item-edit').click((ev) => {
			const li = $(ev.currentTarget).parents('.item');
			const item = this.actor.items.get(li.data('itemId'));
			item.sheet.render(true);
		});

		// Render the item sheet for viewing/editing when middle-clicking
		html.find('.item').mouseup((ev) => {
			if (ev.button === 1 && !$(ev.target).hasClass('item-edit')) {
				ev.preventDefault();
				const li = $(ev.currentTarget);
				const item = this.actor.items.get(li.data('itemId'));
				item.sheet.render(true);
			}
		});

		// Open the active effect dialog when middle-clicking on an effect
		html.find('.effect').mouseup((ev) => {
			if (ev.button === 1 && !$(ev.target).hasClass('effect-control')) {
				const li = $(ev.currentTarget);
				const effectId = li.data('effectId');
				const owner = this.actor;
				let effect;
				if (owner instanceof FUActor) {
					effect = Array.from(owner.allApplicableEffects()).find((value) => value.id === effectId);
				} else {
					effect = owner.effects.get(effectId);
				}
				// Render the sheet for the active effect
				effect.sheet.render(true);
			}
		});

		// -------------------------------------------------------------
		// Everything below here is only needed if the sheet is editable
		if (!this.isEditable) return;

		// Use Equipment
		html.find('.use-equipment').click(this._onUseEquipment.bind(this));

		// Duplicate Inventory Item
		html.find('.item-duplicate').click(this._onItemDuplicate.bind(this));

		// Add Inventory Item
		html.find('.item-create').click(this._onItemCreate.bind(this));

		// Add Inventory Item Dialog
		html.find('.item-create-dialog').click(this._onItemCreateDialog.bind(this));

		// Delete Inventory Item
		html.find('.item-delete').click(async (ev) => {
			const li = $(ev.currentTarget).parents('.item');
			const item = this.actor.items.get(li.data('itemId'));
			const confirmation = await Dialog.confirm({
				title: game.i18n.format('FU.DialogDeleteItemTitle', { item: item.name }),
				content: game.i18n.format('FU.DialogDeleteItemDescription', { item: item.name }),
				rejectClose: false,
			});
			if (confirmation) {
				item.delete();
				li.slideUp(200, () => this.render(false));
			}
		});

		html.find('.study-button').click(() => handleStudyRoll.bind(this)());

		// Add event listeners for increment and decrement buttons
		html.find('.increment-button').on('click contextmenu', (ev) => this._onIncrementButtonClick(ev));
		html.find('.decrement-button').on('click contextmenu', (ev) => this._onDecrementButtonClick(ev));

		// Update Character on Level Up
		html.find('.is-levelup').click((ev) => this._onLevelUp(ev));

		// Update Skill Level
		html.find('.skillLevel input').click((ev) => this._onSkillLevelUpdate(ev));

		// Update Progress - Click Event
		html.find('.progress input').click((ev) => {
			const dataType = $(ev.currentTarget).closest('.progress').data('type');
			this._onProgressUpdate(ev, dataType);
		});

		// Update Progress - Contextmenu Event
		html.find('.progress input').contextmenu((ev) => {
			const dataType = $(ev.currentTarget).closest('.progress').data('type');
			this._onProgressReset(ev, dataType);
		});

		/**
		 * Handles item click events, equipping or unequipping items based on the click type.
		 *
		 * @param {Event} ev - The click event triggering the item click.
		 * @param {boolean} isRightClick - Indicates if the item click is a right-click event.
		 * @returns {void}
		 */
		function handleItemClick(ev, isRightClick) {
			const li = $(ev.currentTarget).parents('.item');
			const itemId = li.data('itemId');
			const item = this.actor.items.get(itemId);
			const itemType = item.system.type;
			const handType = item.system.hands;

			// Determine the slot based on item type
			const slotLookup = {
				weapon: isRightClick ? 'offHand' : 'mainHand',
				shield: isRightClick ? 'offHand' : 'mainHand',
				armor: 'armor',
				accessory: 'accessory',
			};

			const slot = slotLookup[item.type] || 'default';

			// Unequip all items in the same slot
			this.actor.items.forEach((i) => {
				if (i.system.isEquipped && i.system.isEquipped.slot === slot) {
					i.update({
						'system.isEquipped.value': false,
						'system.isEquipped.slot': 'default',
					});
				}
			});

			// Equip the selected item
			item.update({
				'system.isEquipped.value': true,
				'system.isEquipped.slot': slot,
			});

			// Update the HTML icon based on the equipped item
			const icon = li.find('.item-icon');
			icon.removeClass('fa-circle').addClass(getIconClassForEquippedItem(item, itemType, handType));

			// Prevent the default right-click context menu if it's a right-click event
			if (isRightClick) {
				ev.preventDefault();
			}
		}

		// Helper function to get the icon class for an equipped item
		function getIconClassForEquippedItem(item, itemType, handType) {
			if (item.system.isEquipped.slot === 'mainHand' && itemType === 'weapon' && handType === 'two-handed') {
				return 'ra ra-relic-blade ra-2x';
			} else if (item.system.isEquipped.slot === 'mainHand' && itemType === 'weapon' && handType === 'one-handed') {
				return 'ra ra-sword ra-2x';
			} else if (item.system.isEquipped.slot === 'offHand' && itemType === 'weapon') {
				return 'ra ra-sword ra-flip-horizontal ra-2x';
			} else if (item.system.isEquipped.slot === 'mainHand') {
				return item.type === 'shield' && item.system.isDualShield && item.system.isDualShield.value ? 'ra ra-heavy-shield' : 'ra ra-shield';
			} else if (item.system.isEquipped.slot === 'offHand') {
				return 'ra ra-shield';
			} else {
				return 'fas fa-circle';
			}
		}

		html.find('.item-equip').on('click', (ev) => {
			handleItemClick.call(this, ev, false);
		});

		html.find('.item-equip').on('contextmenu', (ev) => {
			handleItemClick.call(this, ev, true);
		});

		const animDuration = 250;

		const toggleDesc = (ev) => {
			const el = $(ev.currentTarget);
			const parentEl = el.closest('li');
			const itemId = parentEl.data('item-id');
			const desc = parentEl.find('.individual-description');

			if (this._expanded.has(itemId)) {
				desc.slideUp(animDuration, () => desc.css('display', 'none'));

				this._expanded.delete(itemId);
			} else {
				desc.slideDown(animDuration, () => {
					desc.css('display', 'block');
					desc.css('height', 'auto');
				});
				this._expanded.add(itemId);
			}
		};

		html.find('.click-item').click(toggleDesc);

		// Add item to Favorite Section
		html.find('.item-favored').click((ev) => {
			const li = $(ev.currentTarget).parents('.item');
			const itemId = li.data('itemId');
			const item = this.actor.items.get(itemId);
			const isFavoredBool = item.system.isFavored.value;
			item.update();
			this.actor.updateEmbeddedDocuments('Item', [{ _id: itemId, 'system.isFavored.value': !isFavoredBool }]);
		});

		// Add item to Behavior Roll
		html.find('.item-behavior').click((ev) => {
			const li = $(ev.currentTarget).parents('.item');
			const itemId = li.data('itemId');
			const item = this.actor.items.get(itemId);
			const isBehaviorBool = item.system.isBehavior.value;
			this.actor.updateEmbeddedDocuments('Item', [{ _id: itemId, 'system.isBehavior.value': !isBehaviorBool }]);
		});

		// Active Effect management
		html.find('.effect-control').click((ev) => onManageActiveEffect(ev, this.actor));
		html.find('.status-effect-toggle').click((event) => {
			event.preventDefault();
			const a = event.currentTarget;
			toggleStatusEffect(this.actor, a.dataset.statusId);
		});

		// Rollable abilities.
		html.find('.rollable').click(this._onRoll.bind(this));

		// Drag events for macros.
		if (this.actor.isOwner) {
			let handler = (ev) => this._onDragStart(ev);
			html.find('li.item').each((i, li) => {
				if (li.classList.contains('inventory-header')) return;
				li.setAttribute('draggable', true);
				li.addEventListener('dragstart', handler, false);
			});
		}

		/**
		 * Handles resting actions for the actor, restoring health and possibly other resources.
		 *
		 * @param {Actor} actor - The actor performing the rest action.
		 * @param {boolean} isRightClick - Indicates if the rest action is triggered by a right-click.
		 * @returns {Promise<void>} A promise that resolves when the rest action is complete.
		 */
		async function onRest(actor, isRightClick) {
			const maxHP = actor.system.resources.hp.max;
			const maxMP = actor.system.resources.mp.max;
			const maxIP = actor.system.resources.ip.max;

			const updateData = {
				'system.resources.hp.value': maxHP,
				'system.resources.mp.value': maxMP,
			};

			if (isRightClick) {
				updateData['system.resources.ip.value'] = maxIP;
			}

			await actor.update(updateData);

			// Rerender the actor's sheet if necessary
			if (updateData['system.resources.ip.value'] || !isRightClick) {
				actor.sheet.render(true);
			}
		}

		// Rest on left-click, different behavior on right-click
		html.find('.rest').on('click contextmenu', async (ev) => {
			ev.preventDefault();
			const isRightClick = ev.type === 'contextmenu';
			await onRest(this.actor, isRightClick);
		});

		async function hpCrisis(actor) {
			const maxHP = actor.system.resources.hp.max;
			const crisisHP = Math.ceil(maxHP / 2);

			const updateData = {
				'system.resources.hp.value': crisisHP,
			};

			await actor.update(updateData);
			actor.sheet.render(true);
		}

		html.find('.crisisHP').on('click', async (ev) => {
			await hpCrisis(this.actor);
		});

		// Check if bonds object exists, if not, initialize
		const bonds = this.actor.system.resources.bonds;
		if (!bonds) {
			const initialBonds = [];
			this.actor.system.resources.bonds = initialBonds;
			this.actor.update({ 'system.resources.bonds': initialBonds });
		} else if (!Array.isArray(bonds)) {
			//Convert bonds as object of indexes to bonds as array
			const currentBonds = [];
			for (const k in bonds) {
				currentBonds[k] = bonds[k];
			}
			this.actor.system.resources.bonds = currentBonds;
			this.actor.update({ 'system.resources.bonds': currentBonds });
		}

		// Event listener for adding a new bonds
		html.find('.bond-add').click(async (ev) => {
			ev.preventDefault();
			const bonds = this.actor.system.resources.bonds;
			const maxBondLength = game.settings.get('projectfu', 'optionBondMaxLength');
			if (bonds.length >= maxBondLength) {
				ui.notifications.warn(`Maximum number of bonds (${maxBondLength}) reached.`);
				return;
			}
			const newBonds = [...bonds];
			newBonds.push({
				name: '',
				admInf: '',
				loyMis: '',
				affHat: '',
				strength: 0,
			});
			await this.actor.update({ 'system.resources.bonds': newBonds });
		});

		// Event listener for deleting a bond
		html.find('.bond-delete').click(async (ev) => {
			ev.preventDefault();
			const bondIndex = $(ev.currentTarget).data('bond-index');
			const newBonds = [...this.actor.system.resources.bonds];
			newBonds.splice(bondIndex, 1);
			await this.actor.update({ 'system.resources.bonds': newBonds });
		});

		const sortButton = html.find('#sortButton');

		// Initialize sortOrder
		this.sortOrder = 1;

		sortButton.mousedown((event) => {
			// Right click changes the sort type
			if (event.button === 2) {
				this.changeSortType();
			} else {
				// Left click switches between ascending and descending order
				this.sortOrder *= -1;
				this.render();
			}
		});

		// Load sorting method from actor flags
		if (this.actor) {
			const flags = this.actor.getFlag('projectfu', 'sortMethod');

			if (flags) {
				flags
					.then((sortMethod) => {
						if (sortMethod) {
							this.sortMethod = sortMethod;
							this.render();
						}
					})
					.catch((error) => {
						console.error(`Error loading sortMethod: ${error}`);
					});
			}
		}

		const updatePilotVehicle = (func) => {
			return (event) => {
				const item = this.actor.items.get(event.currentTarget.dataset.itemId);
				this.actor.update({
					'system.vehicle': this.actor.system.vehicle[func](item),
				});
			};
		};

		html.find('.vehicle-section [data-action=toggleVehicleEmbarked]').on('click', updatePilotVehicle('updateEmbarked').bind(this));
		html.find('[data-action=toggleActiveVehicle][data-item-id]').on('click', updatePilotVehicle('updateActiveVehicle').bind(this));
		html.find('[data-action=toggleArmorModule][data-item-id]').on('click', updatePilotVehicle('updateActiveArmorModule').bind(this));
		html.find('[data-action=toggleWeaponModule][data-item-id]').on('click', updatePilotVehicle('updateActiveWeaponModules').bind(this));
		html.find('[data-action=toggleSupportModule][data-item-id]').on('click', updatePilotVehicle('updateActiveSupportModules').bind(this));

		html.find('a[data-action=spendMetaCurrency]').on('click', () => this.actor.spendMetaCurrency());
	}

	// Method to change the sort type
	changeSortType() {
		if (this.sortMethod === 'name') {
			this.sortMethod = 'type';
		} else {
			this.sortMethod = 'name';
		}

		this.render();
	}

	/**
	 * Handles the event when the "Use Equipment" checkbox is clicked.
	 * If the checkbox is unchecked, it unequips all equipped items in the actor's inventory.
	 *
	 * @param {Event} event - The click event triggering the "Use Equipment" checkbox.
	 * @returns {void} The function does not return a promise.
	 */
	async _onUseEquipment(event) {
		const checkbox = event.currentTarget;
		const isChecked = checkbox.checked;

		if (!isChecked) {
			// Get the actor's item collection
			const itemCollection = this.actor.items;

			// Iterate over each item in the collection
			itemCollection.forEach((item) => {
				if (item.system && item.system.isEquipped && item.system.isEquipped.value === true) {
					// Update the item to set 'system.isEquipped.value' to false
					item.update({
						'system.isEquipped.value': false,
						'system.isEquipped.slot': 'default',
					});
				}
			});
			// Log a message or perform other actions if needed
		} else {
			// Checkbox is checked
		}
	}

	/**
	 * Handles the duplication of an item and adds it to the actor's inventory.
	 *
	 * @param {Event} event - The click event triggering the item duplication.
	 * @returns {Promise<void>} A promise that resolves when the item duplication process is complete.
	 */
	async _onItemDuplicate(event) {
		event.preventDefault();
		const header = event.currentTarget;
		const itemElement = header.closest('.item');

		if (!itemElement) return;

		// Get the item data
		const itemId = itemElement.dataset.itemId;
		const item = this.actor.items.get(itemId);

		if (!item) return;

		// Duplicate the item
		const duplicatedItemData = foundry.utils.duplicate(item);

		// Modify the duplicated item's name
		duplicatedItemData.name = `${item.name}`;
		duplicatedItemData.system.isEquipped = {
			value: false,
			slot: 'default',
		};
		// Add the duplicated item to the actor
		await this.actor.createEmbeddedDocuments('Item', [duplicatedItemData]);
	}

	/**
	 * Handle creating a new Owned Item for the actor using initial data defined in the HTML dataset
	 * @param {Event} event   The originating click event
	 * @private
	 */
	async _onItemCreate(event) {
		event.preventDefault();
		const header = event.currentTarget;
		// Get the type of item to create.
		const type = header.dataset.type;
		// Grab any data associated with this control.
		const data = foundry.utils.duplicate(header.dataset);
		// Initialize a default name.
		const localizedKey = CONFIG.FU.itemTypes[type] || `TYPES.Item.${type}`;
		const name = game.i18n.localize(localizedKey);
		// Prepare the item object.
		const itemData = {
			name: name,
			type: type,
			system: data,
		};
		// Remove the type from the dataset since it's in the itemData.type prop.
		delete itemData.system['type'];

		// Check if the game option exists and is enabled
		if (game.settings.get('projectfu', 'optionAlwaysFavorite')) {
			let item = await Item.create(itemData, { parent: this.actor });
			await item.update({
				'data.isFavored.value': true,
			});
			return item;
		} else {
			// Finally, create the item!
			return await Item.create(itemData, { parent: this.actor });
		}
	}

	async _onItemCreateDialog(event) {
		event.preventDefault();

		const dataType = event.currentTarget.dataset.type;
		let types;
		let clock = false;

		// Get all available item types and class feature types
		const allItemTypes = Object.keys(CONFIG.Item.dataModels);
		const isCharacter = this.actor.type === 'character';
		const isNPC = this.actor.type === 'npc';
		const optionalFeatureTypes = Object.entries(CONFIG.FU.optionalFeatureRegistry.optionals());
		switch (dataType) {
			case 'newClock':
				types = allItemTypes.map((type) => ({ type, label: game.i18n.localize(`TYPES.Item.${type}`) }));
				if (isCharacter) {
					const options = ['miscAbility', 'ritual'];

					// Filter out old zeroPower item type (TODO: Delete later)
					const dontShow = ['zeroPower'];

					// Optional Features
					const optionalFeatures = [];

					// Check if the optionZeroPower setting is false, then add the zeroPower feature
					if (game.settings.get(SYSTEM, SETTINGS.optionZeroPower)) {
						optionalFeatures.push({
							type: 'optionalFeature',
							subtype: 'projectfu.zeroPower',
							label: game.i18n.localize('Zero Power'),
						});
					}

					// Filter out items based on options and dontShow
					types = types.filter((item) => options.includes(item.type) && !dontShow.includes(item.type));

					// Filter out 'quirk' and 'camping' optional feature types
					const filteredOptionalFeatures = optionalFeatures.filter((feature) => !['projectfu.quirk', 'projectfu-playtest.camping'].includes(feature.subtype));

					// Push filtered optional features to types array
					types.push(...filteredOptionalFeatures);
				} else if (isNPC) {
					types = types.filter((item) => ['miscAbility', 'rule'].includes(item.type));
				}
				clock = true;
				break;
			case 'newFavorite':
				types = allItemTypes.map((type) => ({ type, label: game.i18n.localize(`TYPES.Item.${type}`) }));

				if (isCharacter) {
					// Filter out old zeroPower item type (TODO: Delete later)
					let dontShowCharacter = ['rule', 'behavior', 'basic', 'zeroPower']; // Default types to hide for characters
					// Filter out default types to hide for characters
					types = types.filter((item) => !dontShowCharacter.includes(item.type));

					// Conditional rendering for optional features based on system settings
					let dontShowOptional = [];
					if (!game.settings.get(SYSTEM, SETTINGS.optionZeroPower)) {
						dontShowOptional.push('projectfu.zeroPower');
					}
					if (!game.settings.get(SYSTEM, SETTINGS.optionQuirks)) {
						dontShowOptional.push('projectfu.quirk');
					}
					if (!game.settings.get(SYSTEM, SETTINGS.optionCampingRules)) {
						dontShowOptional.push('projectfu-playtest.camping');
					}

					// Optional Features
					let optionalFeatures = optionalFeatureTypes.map(([key, optional]) => ({
						type: 'optionalFeature',
						subtype: key,
						label: game.i18n.localize(optional.translation),
					}));

					// Filter out optional features based on system settings
					let filteredOptionalFeatures = optionalFeatures.filter((feature) => !dontShowOptional.includes(feature.subtype));

					// Push filtered optional features to types array
					types.push(...filteredOptionalFeatures);
				} else if (isNPC) {
					let dontShowNPC = ['class', 'classFeature', 'optionalFeature', 'skill', 'heroic', 'project', 'ritual', 'consumable', 'zeroPower']; // Default types to hide for NPCs
					if (!game.settings.get(SYSTEM, SETTINGS.optionBehaviorRoll)) dontShowNPC.push('behavior');
					// Filter out default types to hide for NPCs
					types = types.filter((item) => !dontShowNPC.includes(item.type));
				}
				break;
			case 'newClassFeatures': {
				const classFeatureTypes = Object.entries(CONFIG.FU.classFeatureRegistry.features());
				types = ['miscAbility', 'project'];
				// Filter out old zeroPower item type (TODO: Delete later)
				// if (game.settings.get(SYSTEM, SETTINGS.optionZeroPower)) types.push('zeroPower');
				types = types.map((type) => ({ type, label: game.i18n.localize(`TYPES.Item.${type}`) }));
				// Class Features
				types.push(
					...classFeatureTypes.map(([key, feature]) => ({
						type: 'classFeature',
						subtype: key,
						label: game.i18n.localize(feature.translation),
					})),
				);

				// Optional Features
				const dontShow = [];
				if (!game.settings.get(SYSTEM, SETTINGS.optionZeroPower)) {
					dontShow.push('projectfu.zeroPower');
				}
				if (!game.settings.get(SYSTEM, SETTINGS.optionQuirks)) {
					dontShow.push('projectfu.quirk');
				}
				if (!game.settings.get(SYSTEM, SETTINGS.optionCampingRules)) {
					dontShow.push('projectfu-playtest.camping');
				}

				// Filter optionalFeatureTypes based on dontShow array
				const filteredOptionalFeatureTypes = optionalFeatureTypes.filter(([key, optional]) => !dontShow.includes(key));

				// Push filtered types to the types array
				types.push(
					...filteredOptionalFeatureTypes.map(([key, optional]) => ({
						type: 'optionalFeature',
						subtype: key,
						label: game.i18n.localize(optional.translation),
					})),
				);
				break;
			}
			default:
				break;
		}

		const buttons = types.map((item) => ({
			label: item.label ?? (item.subtype ? item.subtype.split('.')[1] : item.type),
			callback: () => this._createItem(item.type, clock, item.subtype),
		}));

		new Dialog({
			title: 'Select Item Type',
			content: `<p>Select the type of item you want to create:</p>`,
			buttons: buttons,
		}).render(true);
	}

	async _createItem(type, clock, subtype) {
		const localizedKey = CONFIG.FU.itemTypes[type] || `TYPES.Item.${type}`;
		const name = game.i18n.localize(localizedKey) || `${subtype ? subtype.split('.')[1].capitalize() : type.capitalize()}`;

		const itemData = {
			name: name,
			type: type,
			data: { isFavored: true, ...(clock && { hasClock: true }), ...(subtype && { featureType: subtype }), ...(subtype && { optionalType: subtype }) },
		};

		// Check if the type is 'zeroPower' and set clock to true
		//  TODO: Remove later
		if (type === 'zeroPower') {
			clock = true;
		}

		try {
			let item = await Item.create(itemData, { parent: this.actor });
			await item.update({
				'data.hasClock.value': clock,
				'data.isFavored.value': true,
				'data.featureType': subtype,
				'data.optionalType': subtype,
			});
			ui.notifications.info(`${name} created successfully.`);
			item.sheet.render(true);
			return item;
		} catch (error) {
			console.error(`Error creating/updating item: ${error.message}`);
			ui.notifications.error(`Error creating ${name}: ${error.message}`);
		}
	}

	/**
	 * Rolls a random behavior for the given actor and displays the result in a chat message.
	 *
	 * @returns {void}
	 */
	_rollBehavior() {
		// Filter items in the actor's inventory to find behaviors
		const behaviors = this.actor.items.filter((item) => ['basic', 'weapon', 'shield', 'armor', 'accessory', 'spell', 'miscAbility', 'behavior'].includes(item.type) && item.system.isBehavior?.value);

		// Prepare an array to map behaviors with their weights
		const behaviorMap = [];

		// Populate the behaviorMap based on behavior weights
		behaviors.forEach((behavior) => {
			const weight = behavior.system.weight.value;
			const nameVal = behavior.name;
			const descVal = behavior.system.description;
			const idVal = behavior.id;

			for (let i = 0; i < weight; i++) {
				behaviorMap.push({
					name: nameVal,
					desc: descVal,
					id: idVal,
				});
			}
		});

		// Check if there are behaviors to choose from
		if (behaviorMap.length === 0) {
			console.error('No behavior selected.');
			return;
		}

		// Randomly select a behavior from the behaviorMap
		const randVal = Math.floor(Math.random() * behaviorMap.length);
		const selected = behaviorMap[randVal];

		// Get the item from the actor's items by id
		const item = this.actor.items.get(selected.id); // Use "this.actor" to access the actor's items

		if (item) {
			// Call the item's roll method
			item.roll();
		}

		// Call _targetPriority method passing the selected behavior
		this._targetPriority(selected);

		// Check if the selected behavior's type is "item"
		if (selected.type === 'item') {
			// Get the item from the actor's items by id

			const item = this.actor.items.get(selected.id);
			// Check if the item exists
			if (item) {
				// Return the result of item.roll()
				item._onRoll.bind(this);
			}
		}
	}

	_targetPriority(selected) {
		// Get the array of targeted tokens
		let targetedTokens = Array.from(game.user.targets);

		// Define the content variable
		let content;

		// Extract the name of the selected behavior
		const behaviorName = selected ? selected.name : '';

		if (targetedTokens.length > 0) {
			// Map targeted tokens to numbered tokens with actor names
			const numberedTokens = targetedTokens.map((token, index) => `${index + 1} (${token.actor.name})`);

			// Shuffle the array of numbered tokens
			shuffleArray(numberedTokens);

			// Prepare the content for the chat message
			content = `<b>Actor:</b> ${this.actor.name}${behaviorName ? `<br /><b>Selected behavior:</b> ${behaviorName}` : ''}<br /><b>Target priority:</b> ${numberedTokens.join(' -> ')}`;
		} else {
			// Get the value of optionTargetPriority from game settings
			const settingValue = game.settings.get('projectfu', 'optionTargetPriority');

			// Prepare an array for target priority with a length equal to settingValue
			const targetArray = Array.from({ length: settingValue }, (_, index) => index + 1);

			// Shuffle the array of numbered tokens
			shuffleArray(targetArray);

			// Prepare the content for the chat message
			content = `<b>Actor:</b> ${this.actor.name}${behaviorName ? `<br /><b>Selected behavior:</b> ${behaviorName}` : ''}<br /><b>Target priority:</b> ${targetArray.join(' -> ')}`;
		}

		// Prepare chat data for displaying the message
		const chatData = {
			user: game.user._id,
			speaker: ChatMessage.getSpeaker(),
			whisper: game.user._id,
			content,
		};

		// Create a chat message with the chat data
		ChatMessage.create(chatData);
	}

	/**
	 * Handles the level up action when clicked.
	 *
	 * @param {Event} ev - The input change event.
	 */
	_onLevelUp(ev) {
		const input = ev.currentTarget;
		const actor = this.actor;
		if (!actor) return;

		const exp = actor.system.resources.exp.value;
		if (exp < 10) return;

		const { level } = actor.system;
		const $icon = $(input).css('position', 'relative');
		$icon.animate({ top: '-100%', opacity: 0 }, 500, function () {
			actor.update({
				'system.resources.exp.value': exp - 10,
				'system.level.value': level.value + 1,
			});
			$icon.remove();
		});
	}

	/**
	 * Sets the skill level value to the segment clicked.
	 *
	 * @param {Event} ev - The input change event.
	 */
	_onSkillLevelUpdate(ev) {
		const input = ev.currentTarget;
		const segment = input.value;

		const li = $(input).closest('.item');

		if (li.length) {
			const itemId = li.find('input').data('item-id');
			const item = this.actor.items.get(itemId);

			if (item) {
				item.update({ 'system.level.value': segment });
			} else {
				console.error(`Item with ID ${itemId} not found.`);
			}
		} else {
			console.error('Parent item not found.');
		}
	}

	/**
	 * Handles button click events to update item level or resource progress.
	 * @param {Event} ev - The button click event.
	 * @param {number|string} increment - The value by which to increment or decrement the item level or resource progress.
	 * @param {string} dataType - The type of data ('levelCounter', 'resourceCounter', 'clockCounter', or 'projectCounter').
	 * @param {boolean} rightClick - Indicates whether the click is a right click.
	 * @private
	 */
	async _onButtonClick(ev, increment, dataType, rightClick) {
		const button = ev.currentTarget;
		const li = $(button).closest('.item');

		try {
			if (li.length) {
				const itemId = li.find('[data-item-id]').data('item-id');
				const item = this.actor.items.get(itemId);

				if (item) {
					switch (dataType) {
						case 'levelCounter':
							await this._updateLevel(item, increment);
							break;

						case 'resourceCounter':
							await this._updateResourceProgress(item, increment, rightClick);
							break;

						case 'clockCounter':
							await this._updateClockProgress(item, increment, rightClick);
							break;

						case 'featureCounter':
							await this._updateFeatureProgress(item, increment, rightClick);
							break;
						case 'projectCounter':
							await this._updateProjectProgress(item, increment, rightClick);
							break;

						default:
							console.error('Invalid data-type:', dataType);
							break;
					}
				} else {
					console.error(`Item with ID ${itemId} not found.`);
				}
			}
		} catch (error) {
			console.error(`Error updating item ${dataType === 'levelCounter' ? 'level' : 'rp progress'}:`, error);
		}
	}

	async _updateLevel(item, increment) {
		const newLevel = item.system.level.value + increment;
		await item.update({ 'system.level.value': newLevel });
	}

	async _updateResourceProgress(item, increment, rightClick) {
		const stepMultiplier = item.system.rp.step || 1;
		const maxProgress = item.system.rp.max;
		let newProgress;

		if (rightClick) {
			newProgress = item.system.rp.current + increment * stepMultiplier;
		} else {
			newProgress = item.system.rp.current + increment;
		}

		if (maxProgress !== 0) {
			newProgress = Math.min(newProgress, maxProgress);
		}

		await item.update({ 'system.rp.current': newProgress });
	}

	async _updateClockProgress(item, increment, rightClick) {
		const stepMultiplier = item.system.progress.step || 1;
		const maxProgress = item.system.progress.max;
		let newProgress;

		if (rightClick) {
			newProgress = item.system.progress.current + increment * stepMultiplier;
		} else {
			newProgress = item.system.progress.current + increment;
		}

		if (maxProgress !== 0) {
			newProgress = Math.min(newProgress, maxProgress);
		}

		await item.update({ 'system.progress.current': newProgress });
	}

	async _updateFeatureProgress(item, increment, rightClick) {
		const stepMultiplier = item.system.data.progress.step || 1;
		const maxProgress = item.system.data.progress.max;
		let newProgress;

		if (rightClick) {
			newProgress = item.system.data.progress.current + increment * stepMultiplier;
		} else {
			newProgress = item.system.data.progress.current + increment;
		}

		if (maxProgress !== 0) {
			newProgress = Math.min(newProgress, maxProgress);
		}

		await item.update({ 'system.data.progress.current': newProgress });
	}

	async _updateProjectProgress(item, increment, rightClick) {
		const progressPerDay = item.system.progressPerDay.value || 1;
		const maxProjectProgress = item.system.progress.max;
		let currentProgress;

		if (rightClick) {
			currentProgress = item.system.progress.current + increment * progressPerDay;
		} else {
			currentProgress = item.system.progress.current + increment;
		}

		if (maxProjectProgress !== 0) {
			currentProgress = Math.min(currentProgress, maxProjectProgress);
		}

		await item.update({ 'system.progress.current': currentProgress });
	}

	/**
	 * Handles increment button click events for both level and resource progress.
	 * @param {Event} ev - The button click event.
	 * @private
	 */
	_onIncrementButtonClick(ev) {
		ev.preventDefault();
		const dataType = $(ev.currentTarget).data('type');
		const rightClick = ev.which === 3 || ev.button === 2;
		this._onButtonClick(ev, 1, dataType, rightClick);
	}

	/**
	 * Handles decrement button click events for both level and resource progress.
	 * @param {Event} ev - The button click event.
	 * @private
	 */
	_onDecrementButtonClick(ev) {
		ev.preventDefault();
		const dataType = $(ev.currentTarget).data('type');
		const rightClick = ev.which === 3 || ev.button === 2;
		this._onButtonClick(ev, -1, dataType, rightClick);
	}

	/**
	 * Updates the progress clock value based on the clicked segment.
	 * @param {Event} ev - The input change event.
	 * @private
	 */
	_onProgressUpdate(ev, dataType) {
		const input = ev.currentTarget;
		const segment = input.value;

		const li = $(input).closest('.item');

		if (li.length) {
			// If the clock is from an item
			const itemId = li.data('itemId');
			const item = this.actor.items.get(itemId);

			if (dataType === 'feature') {
				item.update({ 'system.data.progress.current': segment });
			} else {
				item.update({ 'system.progress.current': segment });
			}
		} else {
			this.actor.update({ 'system.progress.current': segment });
		}
	}

	/**
	 * Resets the progress clock.
	 * @param {Event} ev - The input change event.
	 * @private
	 */
	_onProgressReset(ev, dataType) {
		const input = ev.currentTarget;
		const li = $(input).closest('.item');

		if (li.length) {
			// If the clock is from an item
			const itemId = li.data('itemId');
			const item = this.actor.items.get(itemId);

			if (dataType === 'feature') {
				item.update({ 'system.data.progress.current': 0 });
			} else {
				item.update({ 'system.progress.current': 0 });
			}
		} else {
			// If not from an item
			this.actor.update({ 'system.progress.current': 0 });
		}
	}

	/**
	 * Handles clickable rolls based on different roll types.
	 * @param {Event} event   The originating click event
	 * @private
	 */
	_onRoll(event) {
		event.preventDefault();
		const element = event.currentTarget;
		const dataset = element.dataset;

		const isShift = event.shiftKey;
		const isCtrl = event.ctrlKey;
		// Get the value of optionTargetPriorityRules from game settings
		const settingPriority = game.settings.get('projectfu', 'optionTargetPriorityRules');

		// Handle item rolls.
		if (dataset.rollType) {
			if (dataset.rollType === 'item') {
				const itemId = element.closest('.item').dataset.itemId;
				const item = this.actor.items.get(itemId);
				if (item) {
					// if (isCtrl) {
					// 	return promptCheckCustomizer(this.actor, item);
					// } else {
					if (settingPriority && this.actor?.type === 'npc') {
						this._targetPriority();
					}
					return item.roll(isShift);
					// }
				}
			}
			if (dataset.rollType === 'behavior') {
				return this._rollBehavior();
			}
			if (dataset.rollType === 'roll-check' || dataset.rollType === 'roll-init') {
				if (isShift) {
					return promptOpenCheck(this.actor);
				} else if (isCtrl) {
					// OpposedCheck.promptCheck(this.actor, isShift);
				} else {
					return promptCheck(this.actor);
				}
			}
			if (dataset.rollType === 'group-check') {
				GroupCheck.promptCheck(this.actor, isShift);
			}
		}

		// Handle item-slot rolls.
		if (dataset.rollType === 'item-slot') {
			// Get the actor that owns the item
			const actor = this.actor;
			// Get the items that belong to the actor
			const items = actor.items;
			// Determine the slot based on the header element class
			let slot = '';
			if (element.classList.contains('left-hand')) {
				slot = 'mainHand';
			} else if (element.classList.contains('right-hand')) {
				slot = 'offHand';
			} else if (element.classList.contains('acc-hand')) {
				slot = 'accessory';
			} else if (element.classList.contains('armor-hand')) {
				slot = 'armor';
			} else {
				slot = 'default';
			}
			// Filter the items by their equipped slot
			const sameSlotItems = items.filter((i) => i.system.isEquipped && i.system.isEquipped.slot === slot);
			// Get the first item from the filtered collection
			const item = sameSlotItems.find((i) => true);

			// Check if the item exists and call its roll method
			if (item) return item.roll(isShift);
		}

		// Handle affinity-type rolls
		if (dataset.rollType === 'affinity-type') {
			const actor = this.actor;
			const affinity = JSON.parse(dataset.action);

			const affinityName = affinity.label;
			const affinityValue = affinity.affTypeCurr;

			let params = {
				details: { name: affinityName },
				description: affinityValue,
				speaker: ChatMessage.getSpeaker({ actor }),
			};

			createChatMessage(params);
			return;
		}

		// Handle action-type rolls.
		if (dataset.rollType === 'action-type') {
			// Determine the type based on the data-action attribute
			actionHandler(this, dataset.action, isShift);
		}

		// Handle rolls that supply the formula directly.
		if (dataset.roll) {
			const label = dataset.label ? `${dataset.label}` : '';
			const roll = new Roll(dataset.roll, this.actor.getRollData());
			roll.toMessage({
				speaker: ChatMessage.getSpeaker({ actor: this.actor }),
				flavor: label,
				rollMode: game.settings.get('core', 'rollMode'),
			});
			return roll;
		}
	}

	async _updateObject(event, data) {
		// Foundry's form update handlers send back bond information as an object {0: ..., 1: ....}
		// So correct an update in that form and create an updated bond array to properly represent the changes
		const bonds = data.system?.resources?.bonds;
		if (bonds) {
			if (!Array.isArray(bonds)) {
				const currentBonds = [];
				const maxIndex = Object.keys(bonds).length;
				for (let i = 0; i < maxIndex; i++) {
					currentBonds.push(bonds[i]);
				}
				data.system.resources.bonds = currentBonds;
			}
		}
		super._updateObject(event, data);
	}
}

/**
 * Randomizes the order of elements in an array in-place using the Durstenfeld shuffle algorithm.
 *
 * @param {Array} array - The array to be shuffled.
 * @returns {void} The array is modified in-place.
 */
function shuffleArray(array) {
	for (var i = array.length - 1; i > 0; i--) {
		var j = Math.floor(Math.random() * (i + 1));
		var temp = array[i];
		array[i] = array[j];
		array[j] = temp;
	}
}
