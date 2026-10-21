Component({ properties: { order: Object }, methods: { open() { this.triggerEvent('open', { id: this.data.order.id }); } } });
