/**
 * Created by mtorres on 10/12/16.
 */
$(document).ready(function() {

    $('#calendar').fullCalendar({
        // put your options and callbacks here
        events: {
            url: '/calendar/sales/data.json',
            type: 'POST'
        }
    });
});

