<div id="qlo-room-timeline"
    data-ajax-url="{$timeline_ajax_url|escape:'htmlall':'UTF-8'}"
    data-booking-url="{$timeline_booking_url|escape:'htmlall':'UTF-8'}"
    data-hotel="{$timeline_selected_hotel|intval}"
    data-days="{$timeline_range_days|intval}"
    data-can-edit="{if $timeline_can_edit}1{else}0{/if}"
    data-can-book="{if $timeline_can_book}1{else}0{/if}"
    data-today="{$timeline_today|escape:'htmlall':'UTF-8'}"
    data-l-no-rooms="{l s='No rooms found for this hotel.' mod='hotelreservationsystem'}"
    data-l-no-bookings="{l s='No bookings in this period.' mod='hotelreservationsystem'}"
    data-l-create-success="{l s='Room availability confirmed. Opening Book Now…' mod='hotelreservationsystem'}"
    data-l-create-error="{l s='The reservation could not be started.' mod='hotelreservationsystem'}"
    data-l-create-unavailable="{l s='This room is not available for the selected stay.' mod='hotelreservationsystem'}"
    data-l-resize-checkin="{l s='Drag to change check-in' mod='hotelreservationsystem'}"
    data-l-resize-checkout="{l s='Drag to change check-out' mod='hotelreservationsystem'}"
    data-l-load-error="{l s='Could not load the room plan.' mod='hotelreservationsystem'}"
    data-l-move-success="{l s='Room assignment updated.' mod='hotelreservationsystem'}"
    data-l-move-error="{l s='The booking could not be moved.' mod='hotelreservationsystem'}"
    data-l-same-type="{l s='Bookings can be dragged only to another room of the same type.' mod='hotelreservationsystem'}"
    data-l-edit-dates="{l s='Use Edit stay to change check-in or check-out dates.' mod='hotelreservationsystem'}"
    data-l-reference="{l s='Booking' mod='hotelreservationsystem'}"
    data-l-confirm-move="{l s='Move this booking to the selected room?' mod='hotelreservationsystem'}"
    data-l-price-preview="{l s='Estimated stay total (room and booked services)' mod='hotelreservationsystem'}"
    data-l-old-total="{l s='Current total' mod='hotelreservationsystem'}"
    data-l-new-total="{l s='New estimate' mod='hotelreservationsystem'}"
    data-l-difference="{l s='Difference to settle manually' mod='hotelreservationsystem'}"
    data-l-date-save-success="{l s='Stay updated and order totals recalculated. Any balance or refund must be settled manually.' mod='hotelreservationsystem'}"
    data-l-date-save-error="{l s='The stay could not be updated.' mod='hotelreservationsystem'}"
    data-l-room-after-save="{l s='After saving the new dates, the booking will also be moved to the selected room.' mod='hotelreservationsystem'}"
    data-l-date-room-move-error="{l s='The dates were saved, but the room move failed. Verify the booking assignment before retrying.' mod='hotelreservationsystem'}"
    data-l-date-room-move-success="{l s='Stay dates updated and booking moved to the selected room. Order totals recalculated; settle any balance or refund manually.' mod='hotelreservationsystem'}"
    data-l-preview-note="{l s='The estimate follows the order editor pricing rules. Tourism tax is calculated separately where enabled; any balance or refund must be settled manually.' mod='hotelreservationsystem'}">
    <div class="qlo-timeline-toolbar">
        <div class="qlo-timeline-title">
            <h2>{l s='Reception room planner' mod='hotelreservationsystem'}</h2>
            <p>{l s='Review stays by room, move bookings between rooms, or edit stay dates.' mod='hotelreservationsystem'}</p>
        </div>
        <div class="qlo-timeline-controls">
            {if $timeline_can_book}
                <label for="qlo-timeline-mode">{l s='Planner mode' mod='hotelreservationsystem'}</label>
                <select id="qlo-timeline-mode" class="form-control">
                    <option value="manage">{l s='Manage bookings' mod='hotelreservationsystem'}</option>
                    <option value="create">{l s='New reservation' mod='hotelreservationsystem'}</option>
                </select>
            {/if}
            <label for="qlo-timeline-hotel">{l s='Hotel' mod='hotelreservationsystem'}</label>
            <select id="qlo-timeline-hotel" class="form-control">
                {foreach from=$timeline_hotels item=hotel}
                    <option value="{$hotel.id|intval}" {if $hotel.id == $timeline_selected_hotel}selected{/if}>{$hotel.hotel_name|escape:'htmlall':'UTF-8'}</option>
                {/foreach}
            </select>
            <label for="qlo-timeline-room-type">{l s='Room type' mod='hotelreservationsystem'}</label>
            <select id="qlo-timeline-room-type" class="form-control">
                <option value="0">{l s='All room types' mod='hotelreservationsystem'}</option>
            </select>
        </div>
        <div class="qlo-timeline-navigation">
            <button type="button" class="btn btn-default" id="qlo-timeline-prev" aria-label="{l s='Previous period' mod='hotelreservationsystem'}">&lsaquo;</button>
            <button type="button" class="btn btn-default" id="qlo-timeline-today">{l s='Today' mod='hotelreservationsystem'}</button>
            <input type="date" id="qlo-timeline-start" class="form-control" value="{$timeline_today|escape:'htmlall':'UTF-8'}" aria-label="{l s='Start date' mod='hotelreservationsystem'}">
            <button type="button" class="btn btn-default" id="qlo-timeline-next" aria-label="{l s='Next period' mod='hotelreservationsystem'}">&rsaquo;</button>
            <button type="button" class="btn btn-primary" id="qlo-timeline-refresh">{l s='Show' mod='hotelreservationsystem'}</button>
        </div>
    </div>

    <div class="qlo-timeline-help alert alert-info">
        <strong>{l s='Tip:' mod='hotelreservationsystem'}</strong>
        {l s='In Manage bookings mode, drag an active booking to another room of the same type or drag its left or right edge to adjust the stay. You can also use Edit stay. In New reservation mode, drag across empty dates in a room row to check availability and continue in Book Now. Date changes recalculate the order; reception settles any balance or refund manually.' mod='hotelreservationsystem'}
    </div>

    <div class="qlo-timeline-legend">
        <span><i class="qlo-legend-dot qlo-status-assigned"></i>{l s='Assigned' mod='hotelreservationsystem'}</span>
        <span><i class="qlo-legend-dot qlo-status-checked-in"></i>{l s='Checked in' mod='hotelreservationsystem'}</span>
        <span><i class="qlo-legend-dot qlo-status-checked-out"></i>{l s='Checked out' mod='hotelreservationsystem'}</span>
        <span><i class="qlo-legend-dot qlo-status-inactive"></i>{l s='Cancelled / refunded / no-show' mod='hotelreservationsystem'}</span>
        <span class="qlo-timeline-message" id="qlo-timeline-message" role="status"></span>
    </div>

    <div class="qlo-timeline-scroll" id="qlo-timeline-scroll">
        <div class="qlo-timeline-grid" id="qlo-timeline-grid" aria-live="polite">
            <div class="qlo-timeline-loading">{l s='Loading room plan…' mod='hotelreservationsystem'}</div>
        </div>
    </div>
</div>

<script type="text/javascript">
    var admin_order_tab_link = '{$timeline_orders_url|escape:'javascript':'UTF-8'}';
    var rooms_reallocation_url = admin_order_tab_link;
    var token = '{$timeline_orders_token|escape:'javascript':'UTF-8'}';
    var txt_confirm = '{l s='Are you sure?' js=1}';
    var txtSomeErr = '{l s='An error occurred. Please try again.' js=1}';
    var allowBackdateOrder = {if $timeline_allow_backdate}true{else}false{/if};
</script>
