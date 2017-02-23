//Código de los botones del carrito

$('body').find('form').submit(function (e) {
    var button = $(this);
    var modal  = $("#genericModal");
    modal.find('.modal-title').text('Seleccionar tipo de pago');
    modal.find('#modal_content').html("");
    modal.find('#modal_content').load('/type/payment', { /*page:1*/ }, function(){
        modal.find('form').submit(function(event){
            $.post('/carrito/sell', $(this).serialize()).done(function (data) {
                alert(data.message);
                if(data.status=='Ok'){
                    //alert("Venta exitosa");
                    location.reload();
                }
            });
            event.preventDefault();
        });
    });
    modal.modal("show");
    e.preventDefault();
});


$('.fa').click(function(){
    var button = $(this);
   switch(button.data('action')){
       case 'rem_item':
           if (confirm('¿Seguro que quieres quitar el artículo: ' +  button.data('item_name') + ' del carrito?') ) {
               $.post('/carrito/rem', {
                   user_id: button.data('user_id'),
                   item_id: button.data('item_id'),
                   estatus: document.getElementById('estatus').value
               }).done(function (data) {
                   alert(data.message);
                   if (data.status == 'Ok') {
                       // Obtener HTML del carrito
                       location.reload();
                   }
               });
           }
           break;
       case 'inc_item':
           $.post('/carrito/inc', {
               user_id: button.data('user_id'),
               item_id: button.data('item_id'),
               estatus: document.getElementById('estatus').value
           }).done(function (data) {
               alert(data.message);
               if (data.status == 'Ok') {
                   // Obtener HTML del carrito
                   location.reload();
               }
           });
           break;
       case 'dec_item':
           $.post('/carrito/dec', {
               user_id: button.data('user_id'),
               item_id: button.data('item_id'),
               estatus: document.getElementById('estatus').value
           }).done(function (data) {
               alert(data.message);
               if (data.status == 'Ok') {
                   // Obtener HTML del carrito
                   location.reload();
               }
           });
           break;
       default:
   }

});