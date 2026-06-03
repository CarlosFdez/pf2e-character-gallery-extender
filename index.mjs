// We can't be sure about module order, so we must do this AFTER ready
// CharacterGallery does not provide a way to extend what it gives, and immediately builds the database on construction
// So we need to rebuild twice unfortunately
Hooks.once("ready", () => {
    window.setTimeout(() => monkeyPatchGallery());
});

/**
 * Replace the build database to include extended datasheets.
 * The internal data is not exported nor is there a way to tack on anything.
 * So we call the original, rip out the contents, resort, then add them back in again.
 */
async function monkeyPatchGallery() {
    if (!globalThis.CharacterGallery) return;
    console.log("Loading extended datasheets");
    const extended = await importExtendedDatasheets();
    if (extended.length === 0) {
        console.log("No extended datasheets found, aborting");
        return;
    }
    for (const file of extended) {
        console.log(`Found extended datasheet from ${file.module.id}`);
    }

    const application = globalThis.CharacterGallery.application;
    replaceMethod(
        application.constructor,
        "buildDatabase",
        function (original) {
            original();
            const newData = [
                ...this.database.values(),
                ...extended.flatMap((s) => s.data),
            ].sort((a, b) => a.label.localeCompare(b.label, game.i18n.lang));
            this.database.clear();
            for (const data of newData) {
                this.database.set(data.key, data);
            }
        },
    );
    application.rebuildDatabase();
}

async function importExtendedDatasheets() {
    const FilePicker = foundry.applications.apps.FilePicker.implementation;

    // First get inactive module json files
    const activeModules = game.modules
        .filter((m) => m.active)
        .map((m) => `modules/${m.id}`);
    const folders = (await FilePicker.browse("data", "modules"))?.dirs.filter(
        (f) => !activeModules.includes(f),
    );
    const moduleFiles = (
        await Promise.all(
            folders.map(async (f) => {
                try {
                    return await foundry.utils.fetchJsonWithTimeout(
                        `${f}/module.json`,
                    );
                } catch {
                    return null;
                }
            }),
        )
    ).filter((f) => !!f);

    const promises = [];
    for (const module of moduleFiles) {
        const sheetRefs = module.flags?.galleryDatasheets ?? {};
        for (const [id, entry] of Object.entries(sheetRefs)) {
            promises.push(
                (async () => {
                    try {
                        const data = await foundry.utils.fetchJsonWithTimeout(
                            entry.sheet,
                        );
                        return {
                            id,
                            label: module.title,
                            hint: entry.hint,
                            module: {
                                id: module.id,
                                title: module.title,
                            },
                            data,
                        };
                    } catch {
                        console.error(
                            `Failed to load datasheet "${id}" from module "${module.id}"`,
                        );
                    }
                })(),
            );
        }
    }

    return (await Promise.all(promises)).filter((e) => !!e);
}

/** Does what libwrapper does. Monkeypatches an existing object. But without any of the mangling. */
export function replaceMethod(object, name, impl) {
    if (!object) {
        throw new Error(
            `PF2E Action Tracking | Attempted to override property ${String(name)} for an object that does not exist`,
        );
    }

    const original = object.prototype[name];
    object.prototype[name] = function (...args) {
        return impl.apply(this, [original.bind(this), ...args]);
    };
}
