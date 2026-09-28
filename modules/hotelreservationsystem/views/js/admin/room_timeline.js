(function ($) {
    'use strict';

    $(function () {
        var root = $('#qlo-room-timeline');
        if (!root.length) {
            return;
        }

        var grid = $('#qlo-timeline-grid');
        var startInput = $('#qlo-timeline-start');
        var hotelSelect = $('#qlo-timeline-hotel');
        var typeSelect = $('#qlo-timeline-room-type');
        var rangeDays = Math.max(1, parseInt(root.data('days'), 10) || 14);
        var canEdit = String(root.data('can-edit')) === '1';
        var currentData = null;
        var dragBooking = null;
        var activeEditBooking = null;
        var previewTimer = null;
        var previewSequence = 0;
        var dayWidth = 72;
        var roomColumnWidth = 210;
        var busy = false;
        var stayChangesSaved = false;

        function message(text, state) {
            var target = $('#qlo-timeline-message');
            target.removeClass('text-success text-danger text-muted');
            if (state === 'success') {
                target.addClass('text-success');
            } else if (state === 'error') {
                target.addClass('text-danger');
            } else {
                target.addClass('text-muted');
            }
            target.text(text || '');
        }

        function dateAtOffset(isoDate, offset) {
            var date = new Date(isoDate + 'T12:00:00Z');
            date.setUTCDate(date.getUTCDate() + offset);
            return date.toISOString().slice(0, 10);
        }

        function dayOffset(fromDate, toDate) {
            var start = new Date(fromDate + 'T00:00:00Z').getTime();
            var end = new Date(toDate + 'T00:00:00Z').getTime();
            return Math.round((end - start) / 86400000);
        }

        function formatDay(isoDate) {
            var date = new Date(isoDate + 'T12:00:00Z');
            return new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric' }).format(date);
        }

        function statusClass(booking) {
            if (booking.is_refunded || booking.is_back_order || booking.id_status === 4 || booking.id_status === 5) {
                return 'qlo-status-inactive';
            }
            if (booking.id_status === 2) {
                return 'qlo-status-checked-in';
            }
            if (booking.id_status === 3) {
                return 'qlo-status-checked-out';
            }
            return 'qlo-status-assigned';
        }

        function isDraggable(booking) {
            return canEdit && booking.editable && booking.id_status === 1 && !booking.is_refunded && !booking.is_back_order;
        }

        function buildBookingButton(booking) {
            var card = $('<div/>', {
                'class': 'qlo-timeline-booking ' + statusClass(booking),
                'title': (booking.order_reference || root.data('l-reference')) + ' · ' + booking.customer_name + ' · ' + booking.date_from + ' – ' + booking.date_to
            });

            var title = $('<div/>', { 'class': 'qlo-timeline-booking-title' });
            title.text((booking.order_reference ? '#' + booking.order_reference : root.data('l-reference') + ' #' + booking.id)
                + (booking.customer_name ? ' · ' + booking.customer_name : ''));
            card.append(title);

            var dates = $('<div/>', { 'class': 'qlo-timeline-booking-dates' });
            dates.text(booking.date_from + ' – ' + booking.date_to);
            card.append(dates);

            if (booking.editable) {
                var edit = $('<button/>', {
                    type: 'button',
                    'class': 'qlo-timeline-edit',
                    text: '✎'
                });
                edit.attr('aria-label', root.data('l-edit-dates'));
                edit.attr('title', root.data('l-edit-dates'));
                edit.on('click', function (event) {
                    event.preventDefault();
                    event.stopPropagation();
                    openBookingEditor(booking);
                });
                card.append(edit);
            }

            if (isDraggable(booking)) {
                card.attr('draggable', 'true');
                card.on('dragstart', function (event) {
                    dragBooking = booking;
                    event.originalEvent.dataTransfer.effectAllowed = 'move';
                    event.originalEvent.dataTransfer.setData('text/plain', String(booking.id));
                    card.addClass('qlo-dragging');
                });
                card.on('dragend', function () {
                    dragBooking = null;
                    card.removeClass('qlo-dragging');
                    $('.qlo-timeline-lane').removeClass('qlo-drop-target');
                });
            }
            return card;
        }

        function openBookingEditor(booking) {
            if (typeof EditRoomBookingModal === 'undefined' || !EditRoomBookingModal.show) {
                message(root.data('l-load-error'), 'error');
                return;
            }
            activeEditBooking = booking;
            var button = document.createElement('button');
            button.setAttribute('data-product_line_data', JSON.stringify(booking.product_line_data));
            EditRoomBookingModal.show(button);
        }

        function requestStayPricePreview() {
            var requestSequence = ++previewSequence;
            if (!activeEditBooking || !$('#edit-room-booking-modal').length) {
                return;
            }
            var dateFrom = $('#edit_product .edit_product_date_from_actual').val();
            var dateTo = $('#edit_product .edit_product_date_to_actual').val();
            var unitPrice = $('#edit_product .room_unit_price').val();
            var preview = $('#qlo-stay-price-preview');
            if (!preview.length || !dateFrom || !dateTo || !unitPrice) {
                return;
            }

            preview.removeClass('alert-danger').addClass('alert-info').text('…');
            $.ajax({
                url: root.data('ajax-url'),
                method: 'POST',
                dataType: 'json',
                data: {
                    ajax: 1,
                    action: 'previewStayChange',
                    id_booking: activeEditBooking.id,
                    date_from: dateFrom,
                    date_to: dateTo,
                    unit_price_tax_excl: unitPrice
                }
            }).done(function (response) {
                if (requestSequence !== previewSequence) {
                    return;
                }
                if (!response || !response.success) {
                    preview.removeClass('alert-info').addClass('alert-danger').text((response && response.error) || root.data('l-load-error'));
                    return;
                }
                var summary = root.data('l-price-preview') + ': ' + root.data('l-old-total') + ' ' + response.old_total
                    + ' → ' + root.data('l-new-total') + ' ' + response.new_total
                    + ' (' + root.data('l-difference') + ': ' + response.difference + '). ' + root.data('l-preview-note');
                preview.removeClass('alert-danger').addClass('alert-info').text(summary);
            }).fail(function () {
                if (requestSequence === previewSequence) {
                    preview.removeClass('alert-info').addClass('alert-danger').text(root.data('l-load-error'));
                }
            });
        }

        function attachStayPricePreview() {
            var fromInput = $('#edit_product .edit_product_date_from');
            var toInput = $('#edit_product .edit_product_date_to');
            var preview = $('#qlo-stay-price-preview');
            if (!fromInput.length) {
                return;
            }
            if (!preview.length) {
                preview = $('<div/>', {
                    id: 'qlo-stay-price-preview',
                    'class': 'alert alert-info qlo-stay-price-preview',
                    role: 'status'
                }).insertBefore($('#edit_product .nav.nav-tabs').first());
            }

            var originalFromSelect = fromInput.datepicker('option', 'onSelect');
            var originalToSelect = toInput.datepicker('option', 'onSelect');
            fromInput.datepicker('option', 'onSelect', function (dateText, instance) {
                if ($.isFunction(originalFromSelect)) {
                    originalFromSelect.call(this, dateText, instance);
                }
                clearTimeout(previewTimer);
                previewTimer = setTimeout(requestStayPricePreview, 120);
            });
            toInput.datepicker('option', 'onSelect', function (dateText, instance) {
                if ($.isFunction(originalToSelect)) {
                    originalToSelect.call(this, dateText, instance);
                }
                clearTimeout(previewTimer);
                previewTimer = setTimeout(requestStayPricePreview, 120);
            });
            $('#edit_product .room_unit_price').off('input.qloTimeline change.qloTimeline').on('input.qloTimeline change.qloTimeline', function () {
                clearTimeout(previewTimer);
                previewTimer = setTimeout(requestStayPricePreview, 250);
            });
            requestStayPricePreview();
        }

        // orders.js reloads the entire AdminOrders page when this modal closes.
        // On the planner, refresh just the timeline and discard the injected modal.
        $(document).off('click', '#submitRoomChange');
        $(document).on('click', '#submitRoomChange', function (event) {
            event.preventDefault();
            if (!window.confirm(typeof txt_confirm !== 'undefined' ? txt_confirm : '')) {
                return;
            }

            var button = $(this).prop('disabled', true);
            var query = 'ajax=1&token=' + encodeURIComponent(typeof token !== 'undefined' ? token : '')
                + '&action=editRoomOnOrder&' + $('#edit_product').find('input, select, textarea').serialize();
            $('.loading_overlay').show();
            $.ajax({
                type: 'POST',
                url: admin_order_tab_link,
                dataType: 'json',
                data: query
            }).done(function (response) {
                if (response && response.result) {
                    stayChangesSaved = true;
                    $('#edit-room-booking-modal').modal('hide');
                } else {
                    if (typeof jAlert === 'function') {
                        jAlert((response && response.error) || root.data('l-date-save-error'));
                    } else {
                        message((response && response.error) || root.data('l-date-save-error'), 'error');
                    }
                }
            }).fail(function () {
                if (typeof jAlert === 'function') {
                    jAlert(root.data('l-date-save-error'));
                } else {
                    message(root.data('l-date-save-error'), 'error');
                }
            }).always(function () {
                $('.loading_overlay').hide();
                button.prop('disabled', false);
            });
        });
        $(document).off('hidden.bs.modal', '#edit-room-booking-modal');
        $(document).on('hidden.bs.modal', '#edit-room-booking-modal', function () {
            $(this).remove();
            activeEditBooking = null;
            previewSequence++;
            clearTimeout(previewTimer);
            var showSavedMessage = stayChangesSaved;
            stayChangesSaved = false;
            loadTimeline();
            if (showSavedMessage) {
                message(root.data('l-date-save-success'), 'success');
            }
        });
        $(document).on('shown.bs.modal', '#edit-room-booking-modal', attachStayPricePreview);

        function assignTracks(bookings, visibleStart, visibleEnd) {
            var tracks = [];
            var visible = [];
            bookings.forEach(function (booking) {
                var start = booking.date_from < visibleStart ? visibleStart : booking.date_from;
                var end = booking.date_to > visibleEnd ? visibleEnd : booking.date_to;
                if (end <= start) {
                    return;
                }
                var left = dayOffset(visibleStart, start);
                var length = Math.max(1, dayOffset(start, end));
                var track = 0;
                while (tracks[track] !== undefined && tracks[track] > left) {
                    track++;
                }
                tracks[track] = left + length;
                visible.push({ booking: booking, left: left, length: length, track: track });
            });
            return { items: visible, count: Math.max(1, tracks.length) };
        }

        function render(data) {
            currentData = data;
            var startDate = data.start_date;
            var days = data.days;
            var endDate = dateAtOffset(startDate, days);
            var selectedType = String(typeSelect.val() || '0');

            typeSelect.find('option:not(:first)').remove();
            data.room_types.forEach(function (type) {
                typeSelect.append($('<option/>', { value: type.id, text: type.name }));
            });
            typeSelect.val(selectedType);

            var filteredRooms = data.rooms.filter(function (room) {
                return selectedType === '0' || String(room.id_product) === selectedType;
            });

            grid.empty()
                .css('--qlo-days', days)
                .css('--qlo-room-width', roomColumnWidth + 'px')
                .css('--qlo-day-width', dayWidth + 'px')
                .css('width', (roomColumnWidth + days * dayWidth) + 'px');

            var header = $('<div/>', { 'class': 'qlo-timeline-header-row' });
            header.append($('<div/>', { 'class': 'qlo-timeline-room-heading', text: ' ' }));
            var headerDays = $('<div/>', { 'class': 'qlo-timeline-days-header' });
            for (var day = 0; day < days; day++) {
                var date = dateAtOffset(startDate, day);
                var dayCell = $('<div/>', { 'class': 'qlo-timeline-day-heading' });
                dayCell.text(formatDay(date));
                dayCell.attr('title', date);
                if (date === root.data('today')) {
                    dayCell.addClass('qlo-timeline-today');
                }
                headerDays.append(dayCell);
            }
            header.append(headerDays);
            grid.append(header);

            if (!filteredRooms.length) {
                grid.append($('<div/>', { 'class': 'qlo-timeline-empty', text: root.data('l-no-rooms') }));
                return;
            }

            var bookingsByRoom = {};
            data.bookings.forEach(function (booking) {
                if (!bookingsByRoom[booking.id_room]) {
                    bookingsByRoom[booking.id_room] = [];
                }
                bookingsByRoom[booking.id_room].push(booking);
            });

            filteredRooms.forEach(function (room) {
                var row = $('<div/>', { 'class': 'qlo-timeline-room-row' });
                var roomLabel = $('<div/>', { 'class': 'qlo-timeline-room-label' });
                roomLabel.append($('<strong/>', { text: room.room_num }));
                roomLabel.append($('<span/>', { 'class': 'qlo-room-type-name', text: room.room_type_name }));
                if (room.floor) {
                    roomLabel.append($('<span/>', { 'class': 'qlo-room-floor', text: room.floor }));
                }
                if (parseInt(room.id_status, 10) !== 1) {
                    roomLabel.addClass('qlo-room-unavailable');
                }
                row.append(roomLabel);

                var lane = $('<div/>', { 'class': 'qlo-timeline-lane', 'data-room-id': room.id, 'data-product-id': room.id_product });
                var laneDays = $('<div/>', { 'class': 'qlo-timeline-lane-days' });
                for (var cellIndex = 0; cellIndex < days; cellIndex++) {
                    var cellDate = dateAtOffset(startDate, cellIndex);
                    var cell = $('<div/>', { 'class': 'qlo-timeline-day-cell' });
                    if (cellDate === root.data('today')) {
                        cell.addClass('qlo-timeline-today');
                    }
                    laneDays.append(cell);
                }
                lane.append(laneDays);

                var placement = assignTracks(bookingsByRoom[room.id] || [], startDate, endDate);
                var laneHeight = Math.max(54, 10 + placement.count * 46);
                lane.css('height', laneHeight + 'px');
                placement.items.forEach(function (item) {
                    var card = buildBookingButton(item.booking);
                    card.css({
                        left: (item.left * dayWidth + 3) + 'px',
                        width: Math.max(48, item.length * dayWidth - 6) + 'px',
                        top: (5 + item.track * 46) + 'px'
                    });
                    lane.append(card);
                });

                lane.on('dragover', function (event) {
                    if (!dragBooking) {
                        return;
                    }
                    event.preventDefault();
                    event.originalEvent.dataTransfer.dropEffect = 'move';
                    lane.addClass('qlo-drop-target');
                });
                lane.on('dragleave', function (event) {
                    if (!lane[0].contains(event.originalEvent.relatedTarget)) {
                        lane.removeClass('qlo-drop-target');
                    }
                });
                lane.on('drop', function (event) {
                    event.preventDefault();
                    lane.removeClass('qlo-drop-target');
                    if (!dragBooking) {
                        return;
                    }
                    var targetRoomId = parseInt(lane.data('room-id'), 10);
                    var targetProductId = parseInt(lane.data('product-id'), 10);
                    if (targetProductId !== parseInt(dragBooking.id_product, 10)) {
                        message(root.data('l-same-type'), 'error');
                        return;
                    }
                    if (targetRoomId === parseInt(dragBooking.id_room, 10)) {
                        message(root.data('l-edit-dates'), 'muted');
                        return;
                    }
                    reallocateBooking(dragBooking, targetRoomId);
                });

                row.append(lane);
                grid.append(row);
            });

            if (!data.bookings.length) {
                message(root.data('l-no-bookings'), 'muted');
            } else {
                message('', 'muted');
            }
        }

        function loadTimeline() {
            if (busy) {
                return;
            }
            busy = true;
            message('', 'muted');
            grid.html($('<div/>', { 'class': 'qlo-timeline-loading', text: '…' }));

            $.ajax({
                url: root.data('ajax-url'),
                method: 'POST',
                dataType: 'json',
                data: {
                    ajax: 1,
                    action: 'getTimelineData',
                    id_hotel: hotelSelect.val(),
                    start_date: startInput.val(),
                    days: rangeDays
                }
            }).done(function (data) {
                if (!data || !data.success) {
                    grid.empty().append($('<div/>', { 'class': 'qlo-timeline-empty', text: (data && data.error) || root.data('l-load-error') }));
                    return;
                }
                render(data);
            }).fail(function () {
                grid.empty().append($('<div/>', { 'class': 'qlo-timeline-empty', text: root.data('l-load-error') }));
            }).always(function () {
                busy = false;
            });
        }

        function reallocateBooking(booking, targetRoomId) {
            if (!window.confirm(root.data('l-confirm-move'))) {
                return;
            }
            busy = true;
            $.ajax({
                url: root.data('ajax-url'),
                method: 'POST',
                dataType: 'json',
                data: {
                    ajax: 1,
                    action: 'reallocateRoom',
                    id_booking: booking.id,
                    id_room: targetRoomId
                }
            }).done(function (response) {
                if (response && response.success) {
                    busy = false;
                    message(root.data('l-move-success'), 'success');
                    setTimeout(loadTimeline, 0);
                } else {
                    message((response && response.error) || root.data('l-move-error'), 'error');
                }
            }).fail(function () {
                message(root.data('l-move-error'), 'error');
            }).always(function () {
                busy = false;
            });
        }

        $('#qlo-timeline-prev').on('click', function () {
            startInput.val(dateAtOffset(startInput.val(), -rangeDays));
            loadTimeline();
        });
        $('#qlo-timeline-next').on('click', function () {
            startInput.val(dateAtOffset(startInput.val(), rangeDays));
            loadTimeline();
        });
        $('#qlo-timeline-today').on('click', function () {
            startInput.val(root.data('today'));
            loadTimeline();
        });
        $('#qlo-timeline-refresh').on('click', loadTimeline);
        startInput.on('change', loadTimeline);
        hotelSelect.on('change', function () {
            root.attr('data-hotel', hotelSelect.val());
            loadTimeline();
        });
        typeSelect.on('change', function () {
            if (currentData) {
                render(currentData);
            }
        });

        if (!hotelSelect.val()) {
            grid.empty().append($('<div/>', { 'class': 'qlo-timeline-empty', text: root.data('l-no-rooms') }));
        } else {
            loadTimeline();
        }
    });
})(jQuery);
