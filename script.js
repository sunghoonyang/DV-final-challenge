// Global consts
var geojson_url = './asset/manhattan.geojson';
var request_data = './asset/requests.csv';
var vehicle_events_data = './asset/vehicle_events.csv';
var vehicle_paths_data = './asset/vehicle_paths.csv';
var w = 800;
var h = 800;
var formatTime = d3.timeFormat("%e %B");
var start_of_day_unix_ts = new Date(2013, 9, 5, 0, 0, 0).getTime();
var vehicle_paths;
var vehicle_events;
var focus, timeOfDayRaw, svg, mercator, map, map_data, tooltip;
// Prepare data
Promise.all([
    d3.json(geojson_url),
    // d3.json(request_data),
    d3.csv(vehicle_paths_data),
    d3.csv(vehicle_events_data)
]).then(function (files) {
    createPlot(files);
});

function createPlot(data) {
    // prepare map data
    map_data = data[0];
    // prepare vehicle path data
    vehicle_paths = _.sortBy(data[1], ['Timestamp', 'Vehicle_ID']).map((row, i) => {
        row.Index = i;
        row.num_passengers = parseInt(row.Num_Passengers);
        row.Timestamp = parseInt(row.Timestamp) * 1000;
        row.TimestampDate = new Date(row.Timestamp);
        return row
    });
    // tss = vehicle_paths.map(function (d) {
    //     return d.TimestampDate
    // });
    vehicle_events = _.sortBy(data[2], ['Timestamp', 'Vehicle_ID']).map((row, i) => {
        row.Index = i;
        row.Timestamp = parseInt(row.Timestamp) * 1000;
        row.TimestampDate = new Date(row.Timestamp);
        return row
    });
    // populate svg
    svg = d3.select("body").append("svg")
        .attr("width", w)
        .attr("height", h);

    // create map
    map, mercator = createMap(svg);
    // parse requested time of interest
    timeOfDayRaw = document.getElementById("timeOfDay").value;
    // get the focus type
    focus = document.getElementById("focus").text;
    tooltip = d3.select("body").append("div")
        .attr("class", "tooltip")
        .style("opacity", 0);
    const dta_arr = updateData();
    drawMap(dta_arr);
}

function updateData() {
    let [hours, minutes, seconds] = timeOfDayRaw.split(':');
    time_of_interest = toUnixTimestamp(hours, minutes, seconds);
    dur_in_hrs = (time_of_interest - start_of_day_unix_ts) / 1000 / 60 / 60;
    // truncate from time_of_interest
    console.log('time_of_interest:' + time_of_interest);
    const vp_hist = vehicle_paths.filter(function (row) {
        return row.Timestamp <= time_of_interest;
    });
    const ve_hist = vehicle_events.filter(function (row) {
        return row.Timestamp <= time_of_interest;
    });
    // console.log('length of vp_hist: ' + vp_hist.length);
    // console.log('length of ve_hist: ' + ve_hist.length);
    // get indices of updated data for each vehicle w.r.t time_of_interest
    const indices = getUpdatedIndices(vp_hist);
    // console.log('updateData-indices');
    // console.log(indices.slice(0, 10));
    const latest_v_status = vehicleIDasKey(vp_hist.filter(function (d) {
        return indices.includes(d.Index);
    }));
    // compute serving rate (number of rows for each vehicle ID whose Stop_Passengers > 0 upto time_of_interest)
    const servingRates = computeServingRate(indices, ve_hist, time_of_interest, dur_in_hrs);
    mergedData = _.merge(latest_v_status, servingRates);
    dta_arr = Object.values(mergedData);
    const dta_keys = Object.keys(mergedData);
    dta_keys.map(function (e, i) {
        dta_arr[i]['Vehicle_ID'] = e;
        const idle_time_mins = (time_of_interest -  dta_arr[i]['Timestamp']) / 1000 / 60 // mins
        dta_arr[i]['idle_time_mins'] = Math.round(idle_time_mins * 100) / 100;
    });
    // console.log('updateData');
    // console.log(dta_arr.slice(0, 10));
    return dta_arr
}

function vehicleIDasKey(dta) {
    const result = dta.reduce(function (map, obj) {
        const vid = obj.Vehicle_ID;
        delete obj.Vehicle_ID;
        map[vid] = obj;
        return map;
    }, {});
    return result
}

function drawMap(mergedData) {
    const seq = mergedData.map(function (row, i) {
        if (!(row.hasOwnProperty(focus))) {
            return 0
        } else {
            return row[focus]
        }
    });
    console.log(mergedData.slice(0, 10));
    console.log(seq.slice(0, 10));
    // create color ranges
    const colorMaxValue = d3.max(seq);
    const colorMinValue = d3.min(seq);
    const colorDomain = d3.range(colorMinValue, colorMaxValue, (colorMaxValue - colorMinValue) / 5);

    const color = d3.scaleThreshold()
        .domain(colorDomain)
        .range(d3.schemeBlues[5]);

    // populate the latest locations, and tooltip
    svg.selectAll(".vehicle").remove();
    svg.append('g')
        .selectAll('.vehicle')
        .data(mergedData)
        .enter().append('circle')
        .attr('r', 2.5)
        .attr("cx", function (d) {
            // console.log(mercator([d.Longitude, d.Latitude])[0]);
            return mercator([d.Longitude, d.Latitude])[0]
        })
        .attr('class', 'vehicle')
        .attr("cy", function (d) {
            return mercator([d.Longitude, d.Latitude])[1]
        })
        .attr("id", function (d) {
            return d.Vehicle_ID
        })
        .attr("serving-rate", function (d) {
            return d.serving_rate
        })
        .attr("num_passengers", function (d) {
            return d.num_passengers
        })
        .attr('fill', function (d) {
            return color(d[focus])
        })
        .on("mouseover", function (d) {
            // zoom in on the selected
            d3.select(this).transition()
                .duration(200)
                .attr('r', 3.5);
            tooltip.transition()
                .duration(200)
                .style("opacity", .9);
            tooltip.html(
                'SR:' + d.serving_rate + "<br/>" +
                'CP:' + d.num_passengers + "<br/>" +
                'ITM:' + d.idle_time_mins
            )
                .style("left", (d3.event.pageX) + "px")
                .style("top", (d3.event.pageY - 48) + "px")
                .style("bottom", (d3.event.pageY) + "px");
        })
        .on("mouseout", function (d) {
            // zoom out on the selected
            d3.select(this).transition()
                .duration(200)
                .attr('r', 2.5);
            tooltip.transition()
                .duration(500)
                .style("opacity", 0);
        });

    // Legend
    var legendInterval = 45;
    // remove previous
    svg.select("#legend").remove();

    svg.append("g").attr("transform", "translate(80, 70)").attr('id', 'legend');
    d3.select('#legend')
        .attr('class', 'label')
        .append('text')
        .attr("font-size", "22px")
        .attr("x", 0)
        .text(focus);

    colorDomain.forEach((d, i) => {
        d3.select('#legend')
            .append('rect')
            .attr("height", 12)
            .attr("x", i * legendInterval)
            .attr("y", 15)
            .attr("width", legendInterval)
            .style("fill", color(d));
        d3.select('#legend')
            .append('text')
            .attr("height", 8)
            .attr("x", i * legendInterval + 5)
            .text(Math.round(d).toString())
            .attr("y", 45);
    });
    colorDomain.forEach((d, i) => {
        d3.select('#legend')
            .append("line")          // attach a line
            .style("stroke", "black")  // colour the line
            .attr("x1", (i + 1) * legendInterval)     // x position of the first end of the line
            .attr("y1", 10)      // y position of the first end of the line
            .attr("x2", (i + 1) * legendInterval)     // x position of the second end of the line
            .attr("y2", 30)
            .style('stroke-width', '4px');
    });

}

function computeServingRate(indices, ve_hist, time_of_interest, dur_in_hrs) {
    const grp_dta = Enumerable.From(ve_hist)
        .Where(
            function (x) {
                return parseInt(x.Timestamp) <= time_of_interest
            }
        )
        .Where(
            function (x) {
                return parseInt(x.Stop_Passengers) > 0
            }
        )
        .GroupBy(
            "x => x.Vehicle_ID"
        )
        .Select("x => {Vehicle_ID:x.Key(), Count:x.Count(x=>x.Stop_Passengers)}").ToArray();
    final_rv = [];
    grp_dta.forEach(function (d) {
        // round to 2 decimal
        d.serving_rate = Math.round(d.Count / dur_in_hrs * 100) / 100;
        final_rv.push(d);
    });
    return vehicleIDasKey(final_rv)
}

function getUpdatedIndices(vp_hist) {
    // get each vehicle's latest row
    console.log('getUpdatedIndices');
    const arr = _.sortBy(vp_hist, function (row) {
        return row.TimestampDate;
    });
    const answer = Enumerable.From(vp_hist)
        .GroupBy(
            "x => x.Vehicle_ID",
        ).Select("x => {Vehicle_ID:x.Key(), Index:x.Max(x=>x.Index)}").ToArray();
    console.log('result of answer:');
    console.log(answer.slice(100, 110));
    var indices = answer.map(function (d) {
        return d.Index
    });
    indices = _.sortBy(indices, function (e) {
        return e;
    });
    return indices
}

function createMap(svg) {
    // Map Population
    mercator = d3.geoMercator()
        .center([-73.978025, 40.770008])
        .translate([w * 0.5, h * 0.6])
        .scale([h * 250]);
    const path = d3.geoPath().projection(mercator);

    map = svg.append('g')
        .selectAll('path').data(map_data.features)
        .enter()
        .append('path')
        .attr("id", function (d) {
            return d.properties.id
        })
        .attr("d", path)
        .style("fill", "LightGrey");
    return map, mercator
}

function toUnixTimestamp(hours, minutes, seconds) {
    d = new Date(2013, 9, 5, hours, minutes, seconds);
    return d.getTime();
}

// new data request
function submissionEventHandler(val) {
    // console.log('submissionEventHandler');
    timeOfDayRaw = document.getElementById("timeOfDay").value;
    focus = document.getElementById("focus").text.trim();
    var promise = new Promise(function (resolve, reject) {
        resolve(updateData());
    });
    promise.then(function (result) {
        // console.log('inside promise:');
        // console.log(result[0]);
        drawMap(result);
    })
}
