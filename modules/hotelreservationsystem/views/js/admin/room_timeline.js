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
        var canBook = String(root.data('can-book')) === '1';
        var modeSelect = $('#qlo-timeline-mode');
        var plannerMode = modeSelect.length && modeSelect.val() === 'create' ? 'create' : 'manage';
        root.toggleClass('qlo-mode-create', plannerMode === 'create');
        var currentData = null;
        var activeSelection = null;
        var activeResize = null;
        var dragBooking = null;
        var activeEditBooking = null;
        var pendingStayDates = null;
        var pendingRoomMove = null;
        var dragOffsetDays = 0;
        var dragClippedDays = 0;
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

            if (booking.editable && plannerMode === 'manage') {
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

            if (plannerMode === 'manage' && isDraggable(booking)) {
                ['start', 'end'].forEach(function (edge) {
                    var handle = $('<span/>', {
                        'class': 'qlo-timeline-resize-handle qlo-resize-' + edge,
                        'aria-label': edge === 'start' ? root.data('l-resize-checkin') : root.data('l-resize-checkout'),
                        title: edge === 'start' ? root.data('l-resize-checkin') : root.data('l-resize-checkout')
                    });
                    handle.on('mousedown', function (event) {
                        if (event.which !== 1 || activeResize) {
                            return;
                        }
                        event.preventDefault();
                        event.stopPropagation();
                        dragBooking = null;
                        activeResize = {
                            booking: booking,
                            card: card,
                            edge: edge,
                            startX: event.clientX,
                            dateFrom: booking.product_line_data.date_from,
                            dateTo: booking.product_line_data.date_to,
                            originalFrom: booking.product_line_data.date_from,
                            originalTo: booking.product_line_data.date_to
                        };
                        card.addClass('qlo-resizing');
                    });
                    card.append(handle);
                });

                card.attr('draggable', 'true');
                card.on('dragstart', function (event) {
                    if ($(event.originalEvent.target).closest('.qlo-timeline-resize-handle').length) {
                        event.preventDefault();
                        return;
                    }
                    dragBooking = booking;
                    var cardRect = card[0].getBoundingClientRect();
                    var pointerX = event.originalEvent.clientX || cardRect.left;
                    dragOffsetDays = Math.max(0, Math.floor((pointerX - cardRect.left) / dayWidth));
                    var bookingStart = booking.product_line_data.date_from;
                    dragClippedDays = bookingStart < currentData.start_date
                        ? dayOffset(bookingStart, currentData.start_date)
                        : 0;
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

        function openBookingEditor(booking, stayDates, targetRoomId) {
            if (typeof EditRoomBookingModal === 'undefined' || !EditRoomBookingModal.show) {
                message(root.data('l-load-error'), 'error');
                return;
            }
            activeEditBooking = booking;
            pendingStayDates = stayDates || null;
            pendingRoomMove = targetRoomId && parseInt(targetRoomId, 10) !== parseInt(booking.id_room, 10)
                ? { booking: booking, targetRoomId: parseInt(targetRoomId, 10) }
                : null;
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
            if (pendingRoomMove) {
                $('#submitRoomChange').prop('disabled', true);
            }
            $.ajax({
                url: root.data('ajax-url'),
                method: 'POST',
                dataType: 'json',
                data: {
                    ajax: 1,
                    action: 'previewStayChange',
                    id_booking: activeEditBooking.id,
                    target_room_id: pendingRoomMove ? pendingRoomMove.targetRoomId : activeEditBooking.id_room,
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
                if (pendingRoomMove) {
                    $('#submitRoomChange').prop('disabled', false);
                }
                var summary = root.data('l-price-preview') + ': ' + root.data('l-old-total') + ' ' + response.old_total
                    + ' → ' + root.data('l-new-total') + ' ' + response.new_total
                    + ' (' + root.data('l-difference') + ': ' + response.difference + '). ' + root.data('l-preview-note');
                if (pendingRoomMove) {
                    summary += ' ' + root.data('l-room-after-save');
                }
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

            fromInput.datepicker('option', 'altFormat', 'yy-mm-dd');
            toInput.datepicker('option', 'altFormat', 'yy-mm-dd');
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
            if (pendingStayDates) {
                var pendingFrom = $.datepicker.parseDate('yy-mm-dd', pendingStayDates.date_from);
                var pendingTo = $.datepicker.parseDate('yy-mm-dd', pendingStayDates.date_to);
                fromInput.datepicker('setDate', pendingFrom);
                toInput.datepicker('setDate', pendingTo);
                $('#edit_product .edit_product_date_from_actual').val(pendingStayDates.date_from);
                $('#edit_product .edit_product_date_to_actual').val(pendingStayDates.date_to);
                var minimumCheckout = new Date(pendingFrom.getTime());
                minimumCheckout.setDate(minimumCheckout.getDate() + 1);
                toInput.datepicker('option', 'minDate', minimumCheckout);
                pendingStayDates = null;
            }
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
            var followupRoomMove = showSavedMessage ? pendingRoomMove : null;
            stayChangesSaved = false;
            pendingRoomMove = null;
            pendingStayDates = null;
            if (followupRoomMove) {
                reallocateBooking(followupRoomMove.booking, followupRoomMove.targetRoomId, true, true);
            } else {
                loadTimeline();
                if (showSavedMessage) {
                    message(root.data('l-date-save-success'), 'success');
                }
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

        function updateResizedCard(resize) {
            var visibleStart = currentData.start_date;
            var visibleEnd = dateAtOffset(visibleStart, currentData.days);
            var drawStart = resize.dateFrom < visibleStart ? visibleStart : resize.dateFrom;
            var drawEnd = resize.dateTo > visibleEnd ? visibleEnd : resize.dateTo;
            if (drawEnd <= drawStart) {
                return;
            }
            var left = dayOffset(visibleStart, drawStart);
            var length = dayOffset(drawStart, drawEnd);
            resize.card.css({
                left: (left * dayWidth + 3) + 'px',
                width: Math.max(42, length * dayWidth - 6) + 'px'
            });
            resize.card.find('.qlo-timeline-booking-dates').text(resize.dateFrom + ' – ' + resize.dateTo);
        }

        function selectionDay(lane, clientX) {
            var rect = lane[0].getBoundingClientRect();
            return Math.max(0, Math.min(
                currentData.days - 1,
                Math.floor((clientX - rect.left) / dayWidth)
            ));
        }

        function updateSelection(day) {
            if (!activeSelection) {
                return;
            }
            activeSelection.currentDay = day;
            var firstDay = Math.min(activeSelection.startDay, day);
            var lastDay = Math.max(activeSelection.startDay, day);
            var overlay = activeSelection.overlay;
            overlay.css({
                left: (firstDay * dayWidth) + 'px',
                width: ((lastDay - firstDay + 1) * dayWidth) + 'px'
            });
        }

        function clearSelection() {
            if (activeSelection && activeSelection.overlay) {
                activeSelection.overlay.remove();
            }
            activeSelection = null;
            $('.qlo-timeline-lane').removeClass('qlo-selecting');
        }

        function checkAvailabilityAndOpenBooking(selection) {
            var dateFrom = dateAtOffset(currentData.start_date, selection.firstDay);
            var dateTo = dateAtOffset(currentData.start_date, selection.lastDay + 1);
            busy = true;
            modeSelect.prop('disabled', true);
            message('', 'muted');

            $.ajax({
                url: root.data('ajax-url'),
                method: 'POST',
                dataType: 'json',
                data: {
                    ajax: 1,
                    action: 'checkNewStayAvailability',
                    id_room: selection.roomId,
                    date_from: dateFrom,
                    date_to: dateTo
                }
            }).done(function (response) {
                if (!response || !response.success) {
                    message((response && response.error) || root.data('l-create-unavailable') || root.data('l-create-error'), 'error');
                    return;
                }
                message(root.data('l-create-success'), 'success');
                var bookingUrl = root.data('booking-url');
                var query = $.param({
                    id_hotel: hotelSelect.val(),
                    id_room_type: selection.productId,
                    id_room: selection.roomId,
                    date_from: dateFrom,
                    date_to: dateTo
                });
                window.location.href = bookingUrl + (bookingUrl.indexOf('?') === -1 ? '?' : '&') + query;
            }).fail(function () {
                message(root.data('l-create-error'), 'error');
            }).always(function () {
                busy = false;
                modeSelect.prop('disabled', false);
            });
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

            grid.empty();
            // Set CSS custom properties through the native API: older jQuery versions
            // used by some QloApps/XAMPP installs can turn numeric custom values into invalid CSS.
            grid[0].style.setProperty('--qlo-days', String(days));
            grid[0].style.setProperty('--qlo-room-width', roomColumnWidth + 'px');
            grid[0].style.setProperty('--qlo-day-width', dayWidth + 'px');
            grid.css('width', (roomColumnWidth + days * dayWidth) + 'px');

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

                lane.on('mousedown', function (event) {
                    if (plannerMode !== 'create' || !canBook || busy || event.which !== 1
                        || $(event.target).closest('.qlo-timeline-booking').length
                        || parseInt(room.id_status, 10) !== 1
                    ) {
                        return;
                    }
                    event.preventDefault();
                    clearSelection();
                    var startDay = selectionDay(lane, event.clientX);
                    var overlay = $('<div/>', { 'class': 'qlo-timeline-selection' });
                    lane.append(overlay);
                    activeSelection = {
                        lane: lane,
                        roomId: parseInt(room.id, 10),
                        productId: parseInt(room.id_product, 10),
                        startDay: startDay,
                        currentDay: startDay,
                        overlay: overlay
                    };
                    lane.addClass('qlo-selecting');
                    updateSelection(startDay);
                });
                lane.on('mousemove', function (event) {
                    if (activeSelection && activeSelection.lane[0] === lane[0]) {
                        updateSelection(selectionDay(lane, event.clientX));
                    }
                });

                lane.on('dragover', function (event) {
                    if (plannerMode !== 'manage' || !dragBooking) {
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
                    if (plannerMode !== 'manage' || !dragBooking) {
                        return;
                    }
                    var targetRoomId = parseInt(lane.data('room-id'), 10);
                    var targetProductId = parseInt(lane.data('product-id'), 10);
                    if (targetProductId !== parseInt(dragBooking.id_product, 10)) {
                        message(root.data('l-same-type'), 'error');
                        return;
                    }
                    var laneRect = lane[0].getBoundingClientRect();
                    var dropX = event.originalEvent.clientX;
                    var targetDay = Math.max(0, Math.min(
                        currentData.days - 1,
                        Math.floor((dropX - laneRect.left) / dayWidth)
                    ));
                    var newDateFrom = dateAtOffset(currentData.start_date, targetDay - dragOffsetDays - dragClippedDays);
                    var stayNights = Math.max(1, dayOffset(
                        dragBooking.product_line_data.date_from,
                        dragBooking.product_line_data.date_to
                    ));
                    var newDateTo = dateAtOffset(newDateFrom, stayNights);
                    var datesChanged = newDateFrom !== dragBooking.product_line_data.date_from
                        || newDateTo !== dragBooking.product_line_data.date_to;
                    var roomChanged = targetRoomId !== parseInt(dragBooking.id_room, 10);

                    if (!datesChanged && !roomChanged) {
                        return;
                    }
                    if (datesChanged) {
                        openBookingEditor(dragBooking, {
                            date_from: newDateFrom,
                            date_to: newDateTo
                        }, targetRoomId);
                    } else {
                        reallocateBooking(dragBooking, targetRoomId);
                    }
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

        function reallocateBooking(booking, targetRoomId, confirmed, afterDateChange) {
            if (!confirmed && !window.confirm(root.data('l-confirm-move'))) {
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
                    message(afterDateChange ? root.data('l-date-room-move-success') : root.data('l-move-success'), 'success');
                    setTimeout(loadTimeline, 0);
                } else {
                    var errorText = afterDateChange ? root.data('l-date-room-move-error') : root.data('l-move-error');
                    message((response && response.error) || errorText, 'error');
                    if (afterDateChange) {
                        setTimeout(loadTimeline, 0);
                    }
                }
            }).fail(function () {
                message(afterDateChange ? root.data('l-date-room-move-error') : root.data('l-move-error'), 'error');
                if (afterDateChange) {
                    setTimeout(loadTimeline, 0);
                }
            }).always(function () {
                busy = false;
            });
        }

        $(document).on('mousemove.qloTimelineResize', function (event) {
            if (!activeResize || plannerMode !== 'manage') {
                return;
            }
            var resize = activeResize;
            var delta = Math.round((event.clientX - resize.startX) / dayWidth);
            var nights = Math.max(1, dayOffset(resize.originalFrom, resize.originalTo));
            if (resize.edge === 'start') {
                delta = Math.min(nights - 1, delta);
                resize.dateFrom = dateAtOffset(resize.originalFrom, delta);
                resize.dateTo = resize.originalTo;
            } else {
                delta = Math.max(1 - nights, delta);
                resize.dateFrom = resize.originalFrom;
                resize.dateTo = dateAtOffset(resize.originalTo, delta);
            }
            updateResizedCard(resize);
        });
        $(document).on('mouseup.qloTimelineResize', function () {
            if (!activeResize) {
                return;
            }
            var resize = activeResize;
            activeResize = null;
            resize.card.removeClass('qlo-resizing');
            if (resize.dateFrom !== resize.originalFrom || resize.dateTo !== resize.originalTo) {
                openBookingEditor(resize.booking, {
                    date_from: resize.dateFrom,
                    date_to: resize.dateTo
                });
            } else if (currentData) {
                render(currentData);
            }
        });

        $(document).on('mouseup.qloTimelineSelection', function (event) {
            if (!activeSelection) {
                return;
            }
            var selection = activeSelection;
            var endDay = selectionDay(selection.lane, event.clientX);
            selection.lane.removeClass('qlo-selecting');
            clearSelection();
            if (plannerMode !== 'create' || !canBook || !currentData) {
                return;
            }
            selection.firstDay = Math.min(selection.startDay, endDay);
            selection.lastDay = Math.max(selection.startDay, endDay);
            checkAvailabilityAndOpenBooking(selection);
        });

        modeSelect.on('change', function () {
            plannerMode = $(this).val() === 'create' && canBook ? 'create' : 'manage';
            root.toggleClass('qlo-mode-create', plannerMode === 'create');
            clearSelection();
            if (activeResize) {
                activeResize.card.removeClass('qlo-resizing');
                activeResize = null;
            }
            dragBooking = null;
            if (currentData) {
                render(currentData);
            }
            message('', 'muted');
        });

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
