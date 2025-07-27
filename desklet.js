// Mod of the example desklet from the Cinnamon Spices tutorial

const Desklet = imports.ui.desklet;
const St = imports.gi.St;
const Soup = imports.gi.Soup;
const versions = imports.gi.versions;

function NextBus(metadata, desklet_id) {
    this._init(metadata, desklet_id);
}

NextBus.prototype = {
    __proto__: Desklet.Desklet.prototype,

    container: null,

    _init: function(metadata, desklet_id) {
        Desklet.Desklet.prototype._init.call(this, metadata, desklet_id);

        this.setupUI();
    },

    setupUI: function() {
        // main container for the desklet
        this.window = new St.Bin();
        this.text = new St.Label();
        this.text.set_text(JSON.stringify(versions));

        this.window.add_actor(this.text);
        this.setContent(this.window);
    }
}

function main(metadata, desklet_id) {
    return new NextBus(metadata, desklet_id);
}
