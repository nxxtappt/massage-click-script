const days = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];
const monthNames = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

var availabilitiesData = [];
var rescheduleData = "";
var Table = {};
var arraOfTabelData = [];
var auto = true;
var states = "<option value=''>Select State/Province</option>";
var DBStaffList = [];

function getHigerOccElement(array) {
  if (array.length == 0) return null;
  var modeMap = {};
  var maxEl = array[0],
    maxCount = 1;
  for (var i = 0; i < array.length; i++) {
    var el = array[i];
    if (modeMap[el] == null) modeMap[el] = 1;
    else modeMap[el]++;
    if (modeMap[el] > maxCount) {
      maxEl = el;
      maxCount = modeMap[el];
    }
  }
  return maxEl;
}

function getStates() {
  (async () => {
    const where = encodeURIComponent(
      JSON.stringify({
        Country_Code: "US",
      })
    );
    const response = await fetch(
      `https://parseapi.back4app.com/classes/Subdivisions_States_Provinces?limit=100&where=${where}`,
      {
        headers: {
          "X-Parse-Application-Id": "mxsebv4KoWIGkRntXwyzg6c6DhKWQuit8Ry9sHja",
          "X-Parse-Master-Key": "TpO0j3lG2PmEVMXlKYQACoOXKQrL3lwM0HwR9dbH",
        },
      }
    );
    var data = await response.json();
    data = data.results;

    function compare(a, b) {
      if (a.Subdivision_Name < b.Subdivision_Name) {
        return -1;
      }
      if (a.Subdivision_Name > b.Subdivision_Name) {
        return 1;
      }
      return 0;
    }

    data.sort(compare);
    for (x in data) {
      states +=
        "<option value='" +
        data[x].Subdivision_Code +
        "'>" +
        data[x].Subdivision_Name +
        "</option>";
    }
    $(".stateList").html(states);
  })();
}

//getStates();
var timeSlot = [];
var canBook = false;
var availabilitiesList = [];

function setShowFilterSec() {
  if (
    $("#Dropdown").find("input[name='radio-group']:checked").val() ==
    "Specific Therapist"
  ) {
    $(".sessionContent")
      .find(".staffList")
      .val($(".preferenceContent").find(".staffList").val());
    $(".sessionContent")
      .find(".preferStaff img")
      .attr(
        "src",
        $(".sessionContent").find(".staffList option:selected").attr("imageurl")
          ? $(".sessionContent")
              .find(".staffList option:selected")
              .attr("imageurl")
          : "images/defaultImg2.jpg"
      );
    $(".sessionContent")
      .find(".preferStaff h1")
      .text($(".sessionContent").find(".staffList option:selected").text());

    if ($(".sessionContent").find(".staffList option:selected").attr("bio")) {
      $(".viwprofile").attr(
        "data-target",
        `#viewprofile${$(".sessionContent").find(".staffList").val()}`
      );
      $(".viwprofile").show();
    } else {
      $(".viwprofile").hide();
    }
    const dropdownArray = $("#dropdownStaffList").val() ?? [];
    // console.log(dropdownArray);
    $("#preferenceMultiStaff").val(dropdownArray).trigger("change");
    if (dropdownArray.length == 1) {
      updateStaffSelectedBioProfile();
      $(".preferenceTimeRow").show();
      $("#confirmPopUpStaffInfo").css("display", "block");
      sessionStorage.setItem("isTier", true);
    } else {
      if (dropdownArray.length == 0) {
        $("#NoPreference").click();
      }
      $(".preferenceTimeRow").hide();
      $("#confirmPopUpStaffInfo").css("display", "none");
      sessionStorage.setItem("isTier", false);
    }
    $(".availabilityContent").show();
  } else {
    $(".preferenceTimeRow").hide();
    $(".availabilityContent").hide();
    $("#confirmPopUpStaffInfo").css("display", "none");
  }

  if ($(".pregnentCheckbox").prop("checked")) {
    let pregnantIds = $("#pregnantCheck").val();
    let pregnantAge = $("#pregnantCheck")
      .closest("div")
      .find("input[type='number']")
      .val();
    $(".sessionContent")
      .find(".selections_list")
      .find(".pregnantLi")
      .find("img")
      .attr("src", "images/pregnant.jpg");
    $(".sessionContent")
      .find(".selections_list")
      .find(".pregnantLi")
      .find("span")
      .text("Pregnant");

    $(".sessionContent")
      .find("input[name='pregnantMinor']")
      .closest("div")
      .find("input[type='number']")
      .hide();
    $(".sessionContent")
      .find("input[name='pregnantMinor'][value='" + pregnantIds + "']")
      .closest("div")
      .find("input[type='number']")
      .val(pregnantAge);
    $(".sessionContent")
      .find("input[name='pregnantMinor'][value='" + pregnantIds + "']")
      .closest("div")
      .find("input[type='number']")
      .show();
    $(".sessionContent").find(".selections_list").find(".pregnantLi").show();
  } else {
    $(".sessionContent")
      .find("#pregnantCheck")
      .closest("div")
      .find("input[type='number']")
      .hide();
    $(".sessionContent").find("#pregnantCheck").prop("checked", false);
    $(".sessionContent").find(".selections_list").find(".pregnantLi").hide();
  }

  if ($(".minorCheckbox").prop("checked")) {
    let minorIds = $("#minorCheck").val();
    let minorAge = $("#minorCheck")
      .closest("div")
      .find("input[type='number']")
      .val();
    $(".sessionContent")
      .find(".selections_list")
      .find(".minorLi")
      .find("img")
      .attr("src", "images/minor.jpg");
    $(".sessionContent")
      .find(".selections_list")
      .find(".minorLi")
      .find("span")
      .text("Minor");

    $(".sessionContent")
      .find("input[name='pregnantMinor']")
      .closest("div")
      .find("input[type='number']")
      .hide();
    $(".sessionContent")
      .find("input[name='pregnantMinor'][value='" + minorIds + "']")
      .closest("div")
      .find("input[type='number']")
      .val(minorAge);
    $(".sessionContent")
      .find("input[name='pregnantMinor'][value='" + minorIds + "']")
      .closest("div")
      .find("input[type='number']")
      .show();
    $(".sessionContent").find(".selections_list").find(".minorLi").show();
  } else {
    $(".sessionContent")
      .find("#minorCheck")
      .closest("div")
      .find("input[type='number']")
      .hide();
    $(".sessionContent").find("#minorCheck").prop("checked", false);
    $(".sessionContent").find(".selections_list").find(".minorLi").hide();
  }
}

function filterElements() {
  let pressureId = $(".availabilityContent").find(".typeOfPressure").val();
  let pressure = $(".typeOfPressure option:selected").text();
  // console.log(pressure);
  if (pressure != "Select") {
    $(".sessionContent")
      .find(".selections_list")
      .find(".pressureLi")
      .find("span")
      .text(pressure);
    $(".sessionContent").find(".selections_list").find(".pressureLi").show();

    $(".pressures").find("input[name='pressure10']").prop("checked", false);
    $(".pressures")
      .find("input[name='pressure10'][value='" + pressureId + "']")
      .prop("checked", true);
  } else {
    $(".sessionContent").find(".selections_list").find(".pressureLi").hide();
    $(".pressures").find("input[name='pressure10']").prop("checked", false);
  }
}

function getloginName() {
  $.ajax({
    url: url + "/endPoints.php",
    method: "post",
    data: { function: "checklogin", from: "Add-Appointment" },
    success: function (data) {
      var user = JSON.parse(data);
      $(".addAppBy").text(user["name"]);
    },
  });
}

function createLog(postData, apiRes) {
  $.ajax({
    url: url + "/endPoints.php",
    method: "post",
    data: {
      function: "createLog",
      data: JSON.stringify(postData),
      apiRes: apiRes,
    },
    success: function (data) {
      var user = JSON.parse(data);
    },
  });
}

function logs(postData) {
  $.ajax({
    url: url + "/endPoints.php",
    method: "post",
    data: {
      ...postData,
    },
    success: function (data) {
      // var user = JSON.parse(data);
    },
  });
}

function activityLogs(postData) {
  $.ajax({
    url: url + "/endPoints.php",
    method: "post",
    data: {
      function: "tempLogs",
      data: JSON.stringify(postData),
    },
    success: function (data) {
      // var user = JSON.parse(data);
    },
  });
}

function validateEmail(input) {
  var validRegex =
    /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+)*$/;
  if (input.match(validRegex)) {
    return true;
  }

  return false;
}

function createOptions(values) {
  var options = "";
  for (var j = 0; j < values.length; j++) {
    if (values[j]["Active"] == true) {
      options =
        options +
        `<option value="${values[j]["Id"]}">${values[j]["Name"]}</option>`;
    }
  }
  return options;
}

function clientindexes() {
  $(".createAccountContent").show();
}

function places() {
  $(".cityContent").hide();
  $(".placeContent").show();
  $(".loader").hide();
  window.scrollTo(0, 0);
}

function cities() {
  window.scrollTo(0, 0);
  $.ajax({
    url: url + "/endPoints.php",
    method: "post",
    data: { function: "cities" },
    success: function (data) {
      if (isJson(data)) {
        var cities = JSON.parse(data);
        var preferredCity = '<option value="">Select City</option>';
        if (typeof cities == "object") {
          $("#changecity").find(".cityModal").html("");
          for (var i = 0; i < cities.length; i++) {
            $(".cities").append(`<div class="col-lg-4 col-sm-6 col-xs-12">
                             <label class="customlength">
                                        <span class="length_session">
                                            ${cities[i]["City"]}
                                        </span>
                                        <input type="radio" name="City" value="${cities[i]["SiteID"]}" data-text="${cities[i]["City"]}">
                                        <span class="checkmark"></span>
                                    </label>
                            </div>`);
            $("#changecity").find(".citiesModal").append(`
                            <div class="col-lg-10 col-lg-offset-1 col-sm-12 col-xs-12">
                            <label class="customlength">
                                        <span class="length_session">
                                            ${cities[i]["City"]}
                                        </span>
                                        <input type="radio" name="City" value="${cities[i]["SiteID"]}" data-text="${cities[i]["City"]}">
                                        <span class="checkmark"></span>
                                    </label>
                            </div>`);
            preferredCity =
              preferredCity +
              `<option value="${cities[i]["SiteID"]}">${cities[i]["City"]}</option>`;
          }
          $(".signupForm")
            .find("select[name='PreferredCity']")
            .html(preferredCity);
          // if (
          //   sessionStorage.getItem("oakHavenData") &&
          //   window.location.href.includes("?no") &&
          //   auto
          // ) {
          //   $(".cities")
          //     .find(".city_name")
          //     .each(function () {
          //       if (
          //         $(this)
          //           .text()
          //           .includes(
          //             sessionStorage.getItem("oakHavenData").split("_")[1]
          //           )
          //       ) {
          //         $(this)
          //           .closest(".customcity")
          //           .find("input")
          //           .prop("checked", true);
          //         $(".locationContent").show();
          //         $(".nextbtnCity").trigger("click");
          //       }
          //     });
          // } else {
          $(".placeContent").hide();
          $(".loader").hide();
          $(".cityContent").show();
          window.scrollTo(0, 0);
          // }
        }
      } else {
        $(".errorContent").show();
        $(".loader").hide();
      }
    },
    error: function () {},
  });
}

/*function cities(placeId) {
  window.scrollTo(0, 0);
  $.ajax({
    url: url + "/endPoints.php",
    method: "post",
    data: { function: "cities" },
    success: function (data) {
      if (isJson(data)) {
        var cities = JSON.parse(data);
        var preferredCity = '<option value="">Select City</option>';
        if (typeof cities == "object") {
          $("#changecity").find(".cityModal").html("");
          for (var i = 0; i < cities.length; i++) {
            $(".cities").append(`<div class="col-lg-4 col-sm-6 col-xs-12">
                             <label class="customlength">
                                        <span class="length_session">
                                            ${cities[i]["City"]}
                                        </span>
                                        <input type="radio" name="City" value="${cities[i]["SiteID"]}" data-text="${cities[i]["City"]}" data-place="${placeId}">
                                        <span class="checkmark"></span>
                                    </label>
                            </div>`);
            $("#changecity").find(".citiesModal").append(`
                            <div class="col-lg-10 col-lg-offset-1 col-sm-12 col-xs-12">
                            <label class="customlength">
                                        <span class="length_session">
                                            ${cities[i]["City"]}
                                        </span>
                                        <input type="radio" name="City" value="${cities[i]["SiteID"]}" data-text="${cities[i]["City"]}" data-place="${placeId}">
                                        <span class="checkmark"></span>
                                    </label>
                            </div>`);
            preferredCity =
              preferredCity +
              `<option value="${cities[i]["SiteID"]}">${cities[i]["City"]}</option>`;
          }
          $(".signupForm")
            .find("select[name='PreferredCity']")
            .html(preferredCity);
          // if (
          //   sessionStorage.getItem("oakHavenData") &&
          //   window.location.href.includes("?no") &&
          //   auto
          // ) {
          //   $(".cities")
          //     .find(".city_name")
          //     .each(function () {
          //       if (
          //         $(this)
          //           .text()
          //           .includes(
          //             sessionStorage.getItem("oakHavenData").split("_")[1]
          //           )
          //       ) {
          //         $(this)
          //           .closest(".customcity")
          //           .find("input")
          //           .prop("checked", true);
          //         $(".locationContent").show();
          //         $(".nextbtnCity").trigger("click");
          //       }
          //     });
          // } else {
          $(".placeContent").hide();
          $(".loader").hide();
          $(".cityContent").show();
          window.scrollTo(0, 0);
          // }
        }
      } else {
        $(".errorContent").show();
        $(".loader").hide();
      }
    },
    error: function () {},
  });
}*/

function locations(SiteID, placeID) {
  window.scrollTo(0, 0);
  $.ajax({
    url: url + "/endPoints.php",
    method: "post",
    data: { function: "locations", SiteID: SiteID },
    success: function (data) {
      if (isJson(data)) {
        var locations = JSON.parse(data);
        var preferredLocation = '<option value="">Select location</option>';
        if (typeof locations == "object") {
          $("#changelocation").find(".locationsModal").html("");
          for (var i = 0; i < locations.length; i++) {
            $(".locations").append(`<div class="col-lg-4 col-sm-6 col-xs-12">
                            <label class="customlocation ${ locations[i]["Name"].trim()=='S 1st'? 'location-free-parking' : '' }" style="background-image: url(${
                              locations[i]["ImageUrl"]
                            })">
                            <div class="locationinner">
                            <span class="locationpin">
                            <img src="images/locationmap.png" alt="" />
                            </span>
                            <span class="locationaddress">
                            <b city="${locations[i]["City"]}" phone="${
              locations[i]["Phone"] ? locations[i]["Phone"] : 80774
            }">${locations[i]["Name"]}</b><p> ${locations[i]["Address"]}, ${
              locations[i]["Address2"]
            }</p>
                            </span>
                            <input type="radio" name="Location" value="${
                              locations[i]["SiteID"] == 151471 ? 1 : 0
                            }" data-id="${
              locations[i]["MbId"]
            }" data-place="${placeID}">
                            <span class="checkmark"></span>
                            </div>
                            </label>
                            </div>`);
            $("#changelocation").find(".locationsModal").append(`
                            <div class="col-lg-10 col-lg-offset-1 col-sm-12 col-xs-12">
                            <label class="customlocation" style="background-image: url(${
                              locations[i]["ImageUrl"]
                            })">
                            <div class="locationinner">
                            <span class="locationpin">
                            <img src="images/locationmap.png" alt="">
                            </span>
                            <span class="locationaddress">
                            <b>${locations[i]["Name"]}</b><p> ${
              locations[i]["Address"]
            }, ${locations[i]["Address2"]}</p>
                            </span>
                            <input type="radio" name="LocationC" value="${
                              locations[i]["SiteID"] == 151471 ? 1 : 0
                            }" data-id="${
              locations[i]["MbId"]
            }" data-place="${placeID}">
                            <span class="checkmark"></span>
                            </div>
                            </label>
                            </div>`);
            preferredLocation =
              preferredLocation +
              `<option value="${locations[i]["MbId"]}" data-sId=${
                locations[i]["SiteID"] == 151471 ? 1 : 0
              }>${locations[i]["Name"]}</option>`;
          }
          $(".signupForm")
            .find("select[name='PreferredLocation']")
            .html(preferredLocation);
          $(".locationaddress")
            .find("img")
            .parent()
            .prev()
            .css("bottom", "0px");
          $(".locationaddress")
            .find("img")
            .parent()
            .parent()
            .css("padding-left", "40px");
          // if (
          //   sessionStorage.getItem("oakHavenData") &&
          //   window.location.href.includes("?no") &&
          //   auto
          // ) {
          //   $(".locations")
          //     .find(".locationaddress")
          //     .each(function () {
          //       if (
          //         $(this)
          //           .text()
          //           .includes(
          //             sessionStorage.getItem("oakHavenData").split("_")[1]
          //           )
          //       ) {
          //         $(this)
          //           .closest(".customlocation")
          //           .find("input")
          //           .prop("checked", true);
          //         $(".sessionContent").show();
          //         $(".nextbtnLocation").trigger("click");
          //       }
          //     });
          // } else {
          if (placeID == 1) {
            $(".locationContent").show();
            $(".loader").hide();
            $(".cityContent").hide();
            window.scrollTo(0, 0);
          }
          // }
          if (SiteID == 151471) {
            let input = $(".msg-upcoming-center").parent().parent().next();
            // console.log(input,input.val());
            input.next().remove();
            input.remove();
          }
        }
      } else {
        $(".errorContent").show();
        $(".loader").hide();
      }
    },
    error: function () {},
  });
}

function cancleAppointment(siteid, id) {
  $.ajax({
    url: url + "/endPoints.php",
    method: "post",
    data: {
      function: "deleteAppointments",
      siteid: siteid,
      Id: id,
    },
    success: function (data) {
      sessionStorage.removeItem("oakHavenData");
    },
  });
}

function isPassed(srtartDateTime) {
  $.ajax({
    url: url + "/endPoints.php",
    method: "post",
    data: {
      function: "appointmentIsPassed",
      srtartDateTime: srtartDateTime,
    },
    success: function (data) {
      var data = JSON.parse(data);
      return data;
    },
  });
}

function getStaffNames(staffIds, siteId, callback) {
  $.ajax({
    url: url + "/endPoints.php",
    method: "post",
    data: {
      function: "getStaffNames",
      staffIds: staffIds,
      siteId: siteId,
    },
    success: function (data) {
      callback(JSON.parse(data));
    },
  });
}

function addAppointment(clientId = "", clientEmail = "") {
  const placeID = $(".places").find("input:checked").val();
  const cityID = $(".cities").find("input:checked").val();
  const siteid = $(".locations").find("input:checked").val();
  const locationId = $(".locations").find("input:checked").attr("data-id");
  const sessionTypeId =
    $(".customizations").find("input:checked").val().trim() == "Sauna Session"
      ? $(".saunas").find("input:checked").val()
      : $(".sessions").find("input:checked").val();
  var startDateTime = $("#userSelectedTime").attr("from");
  var endDateTime = $("#userSelectedTime").attr("to");
  let gender = $(".cust_filter_gender input[name='radio-group']:checked").val();
  var staffIdsTobeBooked = $("#userSelectedTime").attr("staffids");
  var staffIdsArray = staffIdsTobeBooked.split(",");
  getStaffNames(staffIdsTobeBooked, siteid, function (staffNames) {
    staffNames.sort();
    const firstStaffName = staffNames[0];
    let firstStaffTier = 1;
    if (firstStaffName.includes("Intern")) {
      firstStaffTier = 0;
    } else if (firstStaffName.includes("Tier 2")) {
      firstStaffTier = 2;
    } else if (firstStaffName.includes("Tier 3")) {
      firstStaffTier = 3;
    } else if (firstStaffName.includes("Tier 4")) {
      firstStaffTier = 4;
    }

    activityLogs({
      from: "Add Appointment",
      staffIdsTobeBooked: staffIdsTobeBooked,
      staffIdsArray: staffIdsArray,
      staffNames: staffNames,
      firstStaffTier: firstStaffTier,
      firstStaffName: firstStaffName,
      oldRequest: sessionStorage.getItem("isOldRequested"),
      oldBook: sessionStorage.getItem("isOldBook"),
    });

    let docNotes = "";
    let arrayNotes = [];
    let staffRequested = gender == "Specific Therapist" ? true : false;
    let specificTherapistSelected =
      $("#Dropdown").find('input[name="radio-group"]:checked').val() ==
      "Specific Therapist"
        ? $(".PreferenceStaffSelect option:selected").text()
        : "";
    if (JSON.parse(sessionStorage.getItem("isOldRequested"))) {
      staffRequested = true;
      specificTherapistSelected = $("#therapistNameTitle").text();
    }

    if (placeID == 2) {
      arrayNotes.push("Location: In-Home Session");
      docNotes = docNotes + "\nLocation: In-Home Session";
      arrayNotes.push("Home Address: " + $("input[name='homeAddress']").val());
      docNotes =
        docNotes + "\nHome Address: " + $("input[name='homeAddress']").val();
      arrayNotes.push("Gate Codes: " + $("input[name='gateCodes']").val());
      docNotes =
        docNotes + "\nGate Codes: " + $("input[name='gateCodes']").val();
      arrayNotes.push("Pet Info: " + $("input[name='petInfo']").val());
      docNotes = docNotes + "\nPet Info: " + $("input[name='petInfo']").val();
      arrayNotes.push(
        "Entry Instructions: " + $("input[name='entryInstruction']").val()
      );
      docNotes =
        docNotes +
        "\nEntry Instructions: " +
        $("input[name='entryInstruction']").val();
    } else {
      arrayNotes.push("Location: In-Office Session");
      docNotes = docNotes + "\nLocation: In-Office Session";
    }

    if ($("#promocode").val() !== "") {
      arrayNotes.push("Promo Code - " + $("#promocode").val());
      docNotes = "Promo Code - " + $("#promocode").val();
    }

    if (
      $(".customizations").find("input:checked").val().trim() != "Sauna Session"
    ) {
      let areaFocusSelected = $("#booknow")
        .find("input[name='area-focus']:checked")
        .val();
      if (areaFocusSelected == "Specific Areas") {
        let specificAreas = [];
        // Iterate through all specific areas checkboxes
        $('input[name="specific-areas"]:checked').each(function () {
          specificAreas.push($(this).val());
        });
        // Join the specific areas array values with comma separator
        let specificAreasString = specificAreas.join(", ");
        if (specificAreasString !== "") {
          arrayNotes.push("Focus : Specific Areas - " + specificAreasString);
          docNotes =
            docNotes + "\nFocus : Specific Areas - " + specificAreasString;
        }
      } else if (areaFocusSelected == "Other") {
        let otherString = $("#otherArea").val();
        arrayNotes.push("Focus Area: " + otherString);
        docNotes = docNotes + "\nFocus Area: " + otherString;
      } else {
        arrayNotes.push("Focus - Full Body");
        docNotes = docNotes + "\nFocus - Full Body";
      }

      let pregnantlength = $(".filterOption").find(
        "input[name='pregnant']:checked"
      ).length;
      let pregnantName = $(".filterOption")
        .find("input[name='pregnant']:checked")
        .hasClass("pregnant")
        ? "Pregnant"
        : "Minor";
      let pregnantAge = $(".filterOption")
        .find("input[name='pregnant']:checked")
        .closest("div")
        .find("input[type='number']")
        .val();

      if (pregnantlength && pregnantAge != "") {
        let monthYear =
          pregnantAge != 1
            ? (pregnantName == "Pregnant" ? "month" : "year") + "s"
            : pregnantName == "Pregnant"
            ? "month"
            : "year";
        arrayNotes.push(pregnantName + " - " + pregnantAge + " " + monthYear);
        docNotes =
          docNotes +
          "\n" +
          pregnantName +
          " - " +
          pregnantAge +
          " " +
          monthYear;
      } else if (pregnantlength) {
        arrayNotes.push(pregnantName + " - ");
        docNotes = docNotes + "\n" + pregnantName + " - ";
      }

      let minorlength = $(".filterOption").find(
        "input[name='minor']:checked"
      ).length;
      let minorName = $(".filterOption")
        .find("input[name='minor']:checked")
        .hasClass("pregnant")
        ? "Pregnant"
        : "Minor";
      let minorAge = $(".filterOption")
        .find("input[name='minor']:checked")
        .closest("div")
        .find("input[type='number']")
        .val();

      if (minorlength && minorAge != "") {
        let monthYear =
          minorAge != 1
            ? (minorName == "Pregnant" ? "month" : "year") + "s"
            : minorName == "Pregnant"
            ? "month"
            : "year";
        arrayNotes.push(minorName + " - " + minorAge + " " + monthYear);
        docNotes =
          docNotes + "\n" + minorName + " - " + minorAge + " " + monthYear;
      } else if (minorlength) {
        arrayNotes.push(minorName + " - ");
        docNotes = docNotes + "\n" + minorName + " - ";
      }

      if ($(".typeOfPressure").val() != "") {
        arrayNotes.push(
          "Massage - " + $(".typeOfPressure option:selected").text()
        );
        docNotes =
          docNotes +
          "\nMassage - " +
          $(".typeOfPressure option:selected").text();
      }

      if ($("input[name='Preference']").is(":checked")) {
        if (
          $("input[name='Preference']:checked").val().trim() !=
          "Specific Therapist"
        ) {
          arrayNotes.push(
            "Gender Preference: " + $("input[name='Preference']:checked").val()
          );
          docNotes =
            docNotes +
            "\nGender Preference: " +
            $("input[name='Preference']:checked").val();
        }
      }

      if ($("#booknow").find("input[name='oil-radio']").is(":checked")) {
        arrayNotes.push(
          "Essential Oil: " +
            $("#booknow").find("input[name='oil-radio']:checked").val()
        );
        docNotes =
          docNotes +
          "\nEssential Oil: " +
          $("#booknow").find("input[name='oil-radio']:checked").val();
      }
      if(firstStaffTier){
        arrayNotes.push("Tier selected: " + "Tier " + firstStaffTier);
        docNotes = docNotes + "\nTier selected: " + "Tier " + firstStaffTier;
      }

      if (specificTherapistSelected.trim() != "") {
        arrayNotes.push(
          "Therapist: " +
            firstStaffName +
            "\nI am requesting this specific therapist. Please do not change my appointment."
        );
        docNotes =
          docNotes +
          "\nTherapist: " +
          firstStaffName +
          "\nI am requesting this specific therapist. Please do not change my appointment.";
      } else {
        if (JSON.parse(sessionStorage.getItem("isOldBook"))) {
          arrayNotes.push(
            "Therapist: " +
              firstStaffName +
              "\nI do not have a preference for a specific therapist."
          );
          docNotes =
            docNotes +
            "\nTherapist: " +
            firstStaffName +
            "\nI do not have a preference for a specific therapist.";
        }
      }
    }

    let noteAppointment = $("#booknow").find(".notes").val();
    noteAppointment = noteAppointment.replace(/['"]/g, "");
    if (noteAppointment != "") {
      arrayNotes.push("Notes - " + noteAppointment);
      docNotes = docNotes + "\n" + noteAppointment;
    }
    // if (clientId == "") {
    //   if (
    //     sessionStorage.getItem("oakHavenData") &&
    //     window.location.href.includes("?no") &&
    //     auto
    //   ) {
    //     clientId = sessionStorage.getItem("oakHavenData").split("_")[5];
    //   }
    // }
    // console.log(docNotes);return false;

    let postData = {
      function: "addAppointment",
      siteid: siteid,
      locationId: locationId,
      sessionTypeId: sessionTypeId,
      staffId: staffIdsTobeBooked,
      srtartDateTime: startDateTime,
      endDateTime: endDateTime,
      notes: docNotes,
      id: clientId,
      Email: clientEmail,
      staffRequested: staffRequested,
      gender: gender == "Specific Therapist" ? "None" : gender,
      // duration: 45,
    };

    activityLogs(postData);
    let cueerntTT = new Date();
    cueerntTT = moment(cueerntTT).format("X");

    let aptTime = new Date(startDateTime);
    aptTime = moment(aptTime).format("X");
    // console.log("add-apointment-end", "check-appointmentIsPassed");
    $.ajax({
      url: url + "/endPoints.php",
      method: "post",
      data: {
        function: "appointmentIsPassed",
        srtartDateTime: startDateTime,
      },
      success: function (res) {
        var resData = JSON.parse(res);
        if (resData.data) {
          $(".createAccountContent").hide();
          $("#loginbox").modal("hide");
          $("#booknow").modal("hide");
          $(".bookNowContent").hide();
          $(".loader").hide();
          $(".middlesection").hide();
          $(".allreadyBooked").show();
          $("#alreadyBookMsg").text("Time selected is already passed.");
        } else {
          // console.log(
          //   "check-appointmentIsPassed-end",
          //   "appointment-booking-start"
          // );
          $.ajax({
            url: url + "/endPoints.php",
            method: "post",
            data: postData,
            success: function (data) {
              // console.log("appointment-booking-end");
              var appointmentData = JSON.parse(data);
              // console.log(appointmentData);
              $("#SuppressAccount").modal("hide");
              $("#reportconfirmpopup").modal("hide");
              if (
                appointmentData.Error &&
                appointmentData.Error.Code == "ValidationFailed"
              ) {
                // Oops
                $(".allreadyBooked").show();
                $(".createAccountContent").hide();
                $(".availabilityContent").hide();
                $("#booknow").modal("hide");
                $("#ccModal").modal("hide");
                $(".availabilityContent").closest(".middlesection").hide();
                $(".loader").hide();
                $(".sessionContent").hide();
                $("#allreadyBooked").text(
                  "Oh bummer, another client snagged this spot before we could confirm for you."
                );
                getloginName();
              } else if (
                appointmentData.Error &&
                appointmentData.Error.Code == "BookingSuspended"
              ) {
                $(".locationName").text("Team");
                $(".bookingSuspendedError").show();
                $("#booknow").modal("hide");
                $("#ccModal").modal("hide");
                $(".createAccountContent").hide();
                $(".availabilityContent").hide();
                $(".availabilityContent").closest(".middlesection").hide();
                $(".sessionContent").hide();
                $(".loader").hide();
              } else if (
                appointmentData.Error &&
                appointmentData.Error.Code == "CreditCardRequired"
              ) {
                $(".createAccountContent").hide();
                $("#booknow").modal("hide");
                $(".loader").hide();
                $("#ccModal").modal("show");
              } else if (!!appointmentData.Id) {
                //booked ok
                $(".createAccountContent").hide();
                $(".availabilityContent").hide();
                $(".bookNowContent").hide();
                $("#booknow").modal("hide");
                $("#ccModal").modal("hide");
                $(".addAppBy").text(appointmentData.FirstName);
                $(".sessionContent").hide();
                getloginName();
                $(".appointmentBookedOn").text(
                  moment($("#userSelectedTime").attr("from")).format(
                    "Do MMMM YYYY, h:mm a"
                  )
                );
                $(".thankYouContext").show();

                $(".loader").hide();
                window.scrollTo(0, 0);

                sendAptConfirmMail(
                  // $("#booknow").find(".therapist_name").text(),
                  moment($("#userSelectedTime").attr("from")).format(
                    "Do MMMM YYYY, h:mm a"
                  ),
                  arrayNotes,
                  appointmentData.ClientId,
                  siteid,
                  appointmentData.Id
                );
                if (
                  sessionStorage.getItem("oakHavenData") &&
                  window.location.href.includes("?no")
                ) {
                  cancleAppointment(
                    sessionStorage.getItem("oakHavenData").split("_")[4],
                    sessionStorage.getItem("oakHavenData").split("_")[0]
                  );
                }
                sessionStorage.removeItem("oakHavenData");
              } else {
                $(".somethingWrong").show();
                $(".createAccountContent").hide();
                $(".availabilityContent").hide();
                $(".bookNowContent").hide();
                $("#booknow").modal("hide");
                $("#ccModal").modal("hide");
                $(".availabilityContent").closest(".middlesection").hide();
                $(".loader").hide();
                $(".sessionContent").hide();
                $("#alreadyBookMsg").text(
                  "Oh bummer, another client snagged this spot before we could confirm for you."
                );
                getloginName();
              }
            },
          });
        }
      },
    });
  });
}

function sendOtpMail() {
  var email = $("#signinEmail").val();
  if (validateEmail(email)) {
    $.ajax({
      url: url + "/endPoints.php",
      method: "post",
      data: {
        function: "sendOtpMail",
        email: email,
        id: cId,
        Name: cName,
        siteid: $(".locations").find("input:checked").val(),
        from: "Add-Appointment",
      },
      success: function (data) {
        if (data.split("<br>").pop().includes("Message sent successfully.")) {
          if ($("#loginbox resendOtp").closest(".otp").is(":visible")) {
            $(".timeout").text("2:00");
            $("#resendOTPDiv").css("display", "none");
          } else {
            countdown();
          }
          $(".otp").show();
          $(".mailSendSucess").text("OTP has been sent to your email.");
          $(".mailSendSucess").show();
          // $(".mailSendSucess").fadeIn(300).delay(5000).fadeOut(300);
        }
      },
    });
  } else {
    $("#signinEmail").prop("required", true);
    $(".mailEroSignin").fadeIn("Please enter valid Email.");
    $(".mailEroSignin").fadeIn(300).delay(5000).fadeOut(300);
  }
}

function sendAptConfirmMail(time, notes, custId, siteid, id, withWhome = "") {
  var email = sessionStorage.getItem("oakHavenEmail");
  var firstName = sessionStorage.getItem("oakHavenFirstName");
  var place = $(".places").find("input:checked").val();
  var cityId = $(".cities").find("input:checked").val();
  var session = $(".sessions")
    .find("input:checked")
    .closest(".customlength")
    .text();
  let sessiontime = $('input[type="radio"][name="Session"]:checked').data(
    "text"
  );

  // alert($('.locations').find("input:checked").closest('.customlocation').find(".locationaddress b").attr('phone')+'11');
  let city = $(".locations")
    .find("input:checked")
    .closest(".customlocation")
    .find(".locationaddress b")
    .attr("city");
  $.ajax({
    url: url + "/endPoints.php",
    method: "post",
    data: {
      function: "sendAptConfirmMail",
      email: email,
      withWhome: withWhome,
      time: time,
      firstName: firstName,
      notes: notes,
      session: session,
      place: place,
      cityId: cityId,
      sessiontime: sessiontime,
      date: $("#userSelectedTime").attr("from"),
      location: $(".locations")
        .find("input:checked")
        .closest(".customlocation")
        .find(".locationaddress p")
        .text(),
      city: city,
      phone: $(".locations")
        .find("input:checked")
        .closest(".customlocation")
        .find(".locationaddress b")
        .attr("phone"),
      siteid: siteid,
      custId: custId,
      id: id,
    },

    success: function (data) {
      if ($(".otp").is(":visible")) {
        $(".timeout").text("2:00");
        $(".timeout")
          .closest("div")
          .find(".resendOtp")
          .css("pointer-events", "none");
      } else {
        countdown();
      }
      $(".otp").show();
    },
  });
}

function signin() {
  var email = $("#signinEmail").val();
  var otp = $("#password").val();
  if (otp == "" || email == "") {
    $(".mailEroSignin").text("Please fill all required fields.");
    $(".mailEroSignin").fadeIn(300).delay(5000).fadeOut(300);
  } else {
    $.ajax({
      url: url + "/endPoints.php",
      method: "post",
      data: {
        function: "signin",
        email: email,
        otp: otp,
        clientId: cId,
        Name: cName,
        from: "add-Appointment",
      },
      success: function (data) {
        var user = JSON.parse(data);
        if (user.Success) {
          $(".loader").show();
          $(".profile").find("a:first").text(cName);
          $(".profile").show();
          accounts();
          // addAppointment();
        } else {
          $(".mailEroSignin").text(user.Error);
          $(".mailEroSignin").fadeIn(300).delay(5000).fadeOut(300);
        }
      },
    });
  }
}

function checkSignIn(siteid, searchText, from) {
  logs({
    from: "login-Add-Appointment",
    function: "checkSignIn",
    siteid: siteid,
    SearchText: searchText,
  });
  $.ajax({
    url: url + "/endPoints.php",
    method: "post",
    data: {
      function: "checkSignIn",
      siteid: siteid,
      SearchText: searchText,
      from: "Add-Appointment",
    },
    success: function (data) {
      let clients = JSON.parse(data);
      if (clients.Email) {
        // console.log("yes Email")
        cId = clients["MbId"];
        cName = clients["FirstName"];
        cEmail = clients["Email"];
        $("#loginbox").find(".otp:first").show();
        sendOtpMail();
      } else {
        $(".mailEroSignin").text("The email you entered is incorrect.");
        $(".mailEroSignin").fadeIn(300).delay(5000).fadeOut(300);
      }
    },
  });
}

function clients(siteid, searchText, from) {
  logs({
    from: from,
    function: "clients",
    siteid: siteid,
    SearchText: searchText,
  });
  $.ajax({
    url: url + "/endPoints.php",
    method: "post",
    data: { function: "clients", siteid: siteid, SearchText: searchText },
    success: function (data) {
      var clients = JSON.parse(data);
      if (from == "create") {
        if (clients.length > 0) {
          $(".mailEroSignup").text("This email is already in use.");
          $(".mailEroSignup").fadeIn(300).delay(5000).fadeOut(300);
        } else {
          clientindexes();
        }
      } else if (from == "signin") {
        if (clients.length > 0) {
          var newClients = clients.filter(function (e) {
            return e.SiteID == (siteid === 0 ? 151469 : 151471);
          });

          if (newClients.length > 0) {
            clients = newClients;
          }

          cId = clients[0]["MbId"];
          cName = clients[0]["FirstName"];
          cEmail = clients[0]["Email"];
          signin();
        } else {
          $(".mailEroSignin").text("The email you entered is incorrect.");
          $(".mailEroSignin").fadeIn(300).delay(5000).fadeOut(300);
        }
      } else if (from == "sendmail") {
        if (clients.length > 0) {
          cId = clients[0]["MbId"];
          cName = clients[0]["FirstName"];
          cEmail = clients[0]["Email"];
          $("#loginbox").find(".otp:first").show();
          sendOtpMail();
        } else {
          $(".mailEroSignin").text("The email you entered is incorrect.");
          $(".mailEroSignin").fadeIn(300).delay(5000).fadeOut(300);
        }
      }
    },
  });
}

function sessions(placeID, siteid = null) {
  window.scrollTo(0, 0);
  // if (
  //   sessionStorage.getItem("oakHavenData") &&
  //   window.location.href.includes("?no") &&
  //   auto
  // ) {
  //   $(".sessions")
  //     .find(".length_session")
  //     .each(function () {
  //       if (
  //         $(this)
  //           .text()
  //           .includes(sessionStorage.getItem("oakHavenData").split("_")[2])
  //       ) {
  //         $(this).closest(".customlength").find("input").prop("checked", true);
  //         $(".sessionContent").show();
  //         $(".nextbtnSession").trigger("click");
  //       }
  //     });
  // } else {
  if (placeID == 1) {
    $(".locationContent").hide();
    $("#sessionScreen").show();
    $("#homeSessionScreen").hide();
  } else {
    $(".cityContent").hide();
    $("#homeSessionScreen").show();
    $("#sessionScreen").hide();
  }
  $(".sessionContent").find(".prevbtnSession").attr("data-place", placeID);
  $(".sessionContent").find(".nextbtnSession").attr("data-place", placeID);
  if ($("input[name='City']:checked").val() == "151471") {
    $("#youthSportSelection").val("348");
    $("option[data-identity='youthSportsFilter'][type='office']").val("348");
  } else {
    $("#youthSportSelection").val("412");
    $("option[data-identity='youthSportsFilter'][type='office']").val("412");
  }
  $(".experienceLi")
    .find("span")
    .text($("input[name='experience']:checked").val());
  if ($("input[name='experience']:checked").val() == "Intern Therapists") {
    $(".sessions").find(".intern-therapist").show();
    $(".sessions").find(".specialist-therapist").hide();
    $(".experienceLi")
      .find("img")
      .attr("src", "images/SpecificTherapist-green.png");
  } else {
    $(".sessions").find(".intern-therapist").hide();
    $(".sessions").find(".specialist-therapist").show();
    $(".experienceLi").find("img").attr("src", "images/NoPreference-green.png");
  }
  $(".experienceLi").show();
  $(".sessionContent").show();
  $(".loader").hide();
  // }
}

function typeOfPressure() {
  let pressureId = $(".pressures").find("input:checked").val();
  let selected = "";
  window.scrollTo(0, 0);
  $.ajax({
    url: url + "/endPoints.php",
    method: "post",
    data: {
      function: "typeOfPressure",
      siteid: $(".locations").find("input:checked").val(),
    },
    success: function (data) {
      if (isJson(data)) {
        var sessions = JSON.parse(data);
        if (typeof sessions == "object") {
          var options = '<option value="" hidden>Select</option>';
          // var options = "";
          for (var i = 0; i < sessions.length; i++) {
            selected = sessions[i]["MbId"] == pressureId ? "selected" : "";
            $(".pressures")
              .find(".pressuretype")
              .each(function () {
                if (
                  $(this)
                    .find(".type_head")
                    .text()
                    .includes(sessions[i]["Name"])
                ) {
                  $(this)
                    .find('input[name="pressure10"]')
                    .val(sessions[i]["MbId"]);
                }
              });

            options =
              options +
              `<option value="${sessions[i]["MbId"]}" ${selected} identity="${sessions[i]["Name"]}">${sessions[i]["Name"]}</option>`;
          }
          // console.log("yes");
          $(".typeOfPressure").html(options);
          if ($(".locations").find("input:checked").val() == "0") {
            $(".pressureContent")
              .find(".pregnant_minor")
              .find(".pregnant")
              .val("284,323");
            $(".pressureContent")
              .find(".pregnant_minor")
              .find(".minor")
              .val("282,283");
            $(".cust_filter_gender").find("#pregnantCheck").val("284,323");
            $(".cust_filter_gender").find("#minorCheck").val("282,283");
          } else if ($(".locations").find("input:checked").val() == "1") {
            $(".pressureContent")
              .find(".pregnant_minor")
              .find(".pregnant")
              .val("256");
            $(".pressureContent")
              .find(".pregnant_minor")
              .find(".minor")
              .val("247,246");
            $(".cust_filter_gender").find("#pregnantCheck").val("256");
            $(".cust_filter_gender").find("#minorCheck").val("247,246");
          }
        }

        // $(".selections_list")
        //   .find("li:nth-child(2)")
        //   .find("span")
        //   .text(
        //     $(".sessions")
        //       .find("input:checked")
        //       .closest(".customlength")
        //       .find(".length_session")
        //       .text()
        //   );
        // if (sessionStorage.getItem("oakHavenData") && window.location.href.includes("?no") && auto) {
        //   $(".pressureContent").find(".pressures").find(".Relaxation_therapy").find("input").prop("checked", true);
        //   let slidCount = 0;
        //   let click = false;
        //   $(".slick-list")
        //     .find(".slick-slide")
        //     .each(function () {
        //       slidCount++;
        //       if (slidCount == 7 && click == false) {
        //         // console.log("slidCount", slidCount)
        //         slidCount = 0;
        //         $("body").find(".slick-next").trigger("click");
        //       }
        //       if ($(this).find(".day").attr("date") == sessionStorage.getItem("oakHavenData").split("_")[3].split("T")[0]) {
        //         $("body").find(".day").removeClass("selectedDay");

        //         $(this).find(".day").addClass("selectedDay");
        //         $(".sessionContent").show();
        //         $(".nextbtnPressure").trigger("click");
        //         click = true;
        //       }
        //     });
        // } else {
        if (
          $(".customizations").find("input:checked").val() ==
          "Cutomize My Session"
        ) {
          $(".pressureContent").show();
          $(".preferenceContent").hide();
          $(".loader").hide();
        }
        // }
      } else {
        $(".preferenceContent").hide();
        // $(".sessionContent").hide();
        $(".errorContent").show();
        $(".loader").hide();
      }
    },
  });
}

function typeOfPressureDropdown() {
  let pressureId = $(".pressures").find("input:checked").val();
  let selected = "";
  window.scrollTo(0, 0);
  $.ajax({
    url: url + "/endPoints.php",
    method: "post",
    data: {
      function: "typeOfPressure",
      siteid: $(".locations").find("input:checked").val(),
    },
    success: function (data) {
      if (isJson(data)) {
        var sessions = JSON.parse(data);
        if (typeof sessions == "object") {
          var options = '<option value="" hidden>Select</option>';
          // var options = "";
          for (var i = 0; i < sessions.length; i++) {
            selected = sessions[i]["MbId"] == pressureId ? "selected" : "";
            $(".pressures")
              .find(".pressuretype")
              .each(function () {
                if (
                  $(this)
                    .find(".type_head")
                    .text()
                    .includes(sessions[i]["Name"])
                ) {
                  $(this)
                    .find('input[name="pressure10"]')
                    .val(sessions[i]["MbId"]);
                }
              });

            options =
              options +
              `<option value="${sessions[i]["MbId"]}" ${selected} identity="${sessions[i]["Name"]}">${sessions[i]["Name"]}</option>`;
          }
          // console.log("yes");
          $(".typeOfPressure").html(options);
        }

        // $(".selections_list")
        //   .find("li:nth-child(2)")
        //   .find("span")
        //   .text(
        //     $(".sessions")
        //       .find("input:checked")
        //       .closest(".customlength")
        //       .find(".length_session")
        //       .text()
        //   );
        // if (sessionStorage.getItem("oakHavenData") && window.location.href.includes("?no") && auto) {
        //   $(".pressureContent").find(".pressures").find(".Relaxation_therapy").find("input").prop("checked", true);
        //   let slidCount = 0;
        //   let click = false;
        //   $(".slick-list")
        //     .find(".slick-slide")
        //     .each(function () {
        //       slidCount++;
        //       if (slidCount == 7 && click == false) {
        //         // console.log("slidCount", slidCount)
        //         slidCount = 0;
        //         $("body").find(".slick-next").trigger("click");
        //       }
        //       if ($(this).find(".day").attr("date") == sessionStorage.getItem("oakHavenData").split("_")[3].split("T")[0]) {
        //         $("body").find(".day").removeClass("selectedDay");

        //         $(this).find(".day").addClass("selectedDay");
        //         $(".sessionContent").show();
        //         $(".nextbtnPressure").trigger("click");
        //         click = true;
        //       }
        //     });
        // } else {
        // }
      } else {
        $(".preferenceContent").hide();
        // $(".sessionContent").hide();
        $(".errorContent").show();
        $(".loader").hide();
      }
    },
  });
}

function getPrice(siteid, sessionTypeIds, name) {
  let tier = 1;
  let session = $(".sessions").find("input:checked").val();
  let place = $(".places").find("input:checked").val();
  // console.log(session);
  if (name.includes("Tier 2")) {
    tier = 2;
  } else if (name.includes("Tier 3")) {
    tier = 3;
  } else if (name.includes("Tier 4")) {
    tier = 4;
  }
  $.ajax({
    url: url + "/endPoints.php",
    method: "post",
    data: {
      function: "price",
      siteid: siteid,
      SessionTypeIds: sessionTypeIds,
      tier: tier,
      place: place,
    },
    success: function (data) {
      price = JSON.parse(data);
      tier = JSON.parse(sessionStorage.getItem("isTier")) ? price.Tier : 0;
      // console.log("serviceData", price.Price);

      // if(!($("#booknow").find(".therapist_name").text()).includes("Tier 3")){
      //     $(".agree").hide();
      //     $("#booknow").find(".newlabel").show();
      //     $("#booknow").find(".massage_rate").html($('.sessions').find("input:checked").closest(".customlength").text());
      //     $(".priceShow").hide();
      //     $(".priceHide").show();
      // }else{
      $(".priceShow").show();
      $(".priceHide").hide();
      $(".agree").show();
      $("#booknow").find(".newlabel").show();
      $("#booknow")
        .find(".massage_rate")
        .html(
          `<b>$${price.Price}</b> for ${$(`select.lengthOfSession`)
            .find(`option[value='${session}']`)
            .text()
            .trim()}`
        );
      $("#booknow")
        .find(".price_terms_conditions")
        .html(
          `<b>*</b>Members will receive an additional discount at checkout.`
        )
        .css("font-size", "12px");
      // }
      $("#booknow").find("input[type='checkbox']").prop("checked", false);

      $("#booknow").find(".notes").val("");
      $("#booknow")
        .find("input[name='preference-radio']")
        .prop("checked", false);
      $("#promocode").val("");
      $(`input[name='Tier'][value='${tier}']`).prop("checked", true);

      $(".tierListFilter").val(tier);
    },
  });
}

function addTherapistRows() {
  // console.log('add thereapist row called')
  // console.log(DBStaffList,DBStaffList.length);
  let places = $(".places").find("input:checked").val();
  if ($.fn.DataTable.isDataTable(".avilable_therapist_all")) {
    $(".avilable_therapist_all").DataTable().destroy();
  }

  $(".avilable_therapist_all tbody").empty();
  $(".tempTable").find("tbody").html("");
  $("#avilable_sauna_rooms").hide();
  let tableBody = $(".avilable_therapist_all tbody");
  let tableHead = $(".avilable_therapist_all thead");

  let locationOptions = $("body")
    .find("#changelocation")
    .find(".locationsModal .customlocation")
    .closest(`div`);
  let count = 0;
  for (let i = 0; i < locationOptions.length; i++) {
    if (locationOptions[i].style.display != "none") {
      count++;
    }
  }

  if (DBStaffList.length == 0) {
    // console.log("null>>>",DBStaffList);
    // Create a single row indicating no timings available
    let buttonL = "";
    if ($(".cities").find("input:checked").val() == "151469" && places == 1) {
      buttonL = `<button type="button" class="btn booknowbtn mx-5 noStaffChangelocation" style="width: auto;" >switch to another location </button>`;
    }
    let newRow = $(
      "<tr style='display: flex;justify-content:center;width: 100% !important;'>"
    ).append(
      $("<td colspan='your_column_count'>").html(
        `<div class="row">
                               <div class="col-md-6 col-md-offset-3 col-sm-10 col-sm-offset-1">
                            <div class="no-therapist">
                                <div class="row">
                                    <div class="col-md-12 text-center">
                                    <img src="images/nodata.png" alt="" />
                                    </div>
                                    <div class="col-md-12">
                                       <h2 class="nodatatext"> Your current search resulted in no availability - try broadening your search, or call our office for help with a specific request.</h2>
                                    </div>
                                    <div class="col-md-12 text-center">${buttonL}</div>
                                </div>
                            </div>
                               </div>
                           </div>`
      )
    );
    // Append the row to the table body
    tableBody.append(newRow);
    tableHead.find("tr").eq(1).hide();
  } else {
    tableHead.find("tr").eq(1).show();
    Table = $(".avilable_therapist_all").DataTable({
      language: {
        emptyTable: `<div class="row">
                               <div class="col-md-6 col-md-offset-3 col-sm-10 col-sm-offset-1">
                            <div class="no-therapist">
                                <div class="row">
                                    <div class="col-md-12 text-center">
                                    <img src="images/nodata.png" alt="" />
                                    </div>
                                    <div class="col-md-12">
                                       <h2 class="nodatatext"> We're sorry, no therapists are available at this time.</h2>
                                    </div>
                                    ${
                                      count > 1
                                        ? '<div class="col-md-12 text-center"><button type="button" class="btn booknowbtn mx-5 noStaffChangelocation" style="width: auto;" >switch to another location </button></div>'
                                        : ""
                                    }
                                </div>
                            </div>
                               </div>
                           </div>`,
      },
      responsive: false,
      bLengthChange: false,
      bInfo: false,
      bAutoWidth: false,
      searchable: false,
      columnDefs: [{ searchable: false, targets: 0 }],
    });

    var id = 0;
    var gender = $(
      ".cust_filter_gender input[name='radio-group']:checked"
    ).val();

    var timing = $("body").find('input[name="timings"]:checked').val();
    var startFrom = parseInt(timing.split(",")[0]) * 60;
    var endAt = parseInt(timing.split(",")[1]) * 60;

    // DBStaffList = JSON.parse(DBStaffList);
    let isStaff =
      $("#Dropdown").find('input[name="radio-group"]:checked').val() ==
        "Specific Therapist" && JSON.parse(sessionStorage.getItem("isTier"));
    // console.log("isStafff>>>",isStaff);
    $("#avilable_therapist_all")
      .find("thead tr")
      .eq(1) // selects the second <tr> (index 1)
      .find("th")
      .eq(0) // selects the first <th> in that row
      .html(isStaff ? "Available Dates" : `Therapists`);
    $("#avilable_therapist_all")
      .find("thead tr")
      .eq(0) // selects the second <tr> (index 1)
      .find("th")
      .eq(0) // selects the first <th> in that row
      .html(
        isStaff
          ? "Available Dates & Timings"
          : `Available Therapists <button type="button" id="showAvailableTimes" class="btn btn-primary" style="margin-left: 10px;padding: 8px 10px 6px 10px;line-height: 14px;background-color: var(--bg-color);">Click To Show Available Times</button>`
      );
    for (var i = 0; i < DBStaffListAll.length; i++) {
      var sessionTime = DBStaffListAll[i]["AvailabilitiesOption"];
      // console.log(DBStaffListAll[i]["AvailabilitiesOption"],DBStaffListAll[i]["MbId"]);
      if (
        DBStaffListAll[i]["Bio"] != "" &&
        $("body").find(`#viewprofile${DBStaffListAll[i]["MbId"]}`).length == 0
      ) {
        $("body").append(`<div id="viewprofile${
          DBStaffListAll[i]["MbId"]
        }" class="modal fade newmodal" role="dialog">
                                <div class="modal-dialog modal-lg">

                                    <div class="modal-content">
                                        <div class="modal-header">
                                            <button type="button" class="close" data-dismiss="modal">
                                                <img src="images/cancel3.png" alt="" />
                                            </button>
                                            <div class="row">
                                              <div class="col-md-12 text-center">
                                                  <div class="page_name_modal">Profile </div>
                                              </div>
                                            </div>
                                        </div>
                                        <div class="modal-body">
                                        <div class="text-center">
                                        <img class="img-thumbnail" src="${
                                          !!DBStaffListAll[i]["ImageUrl"]
                                            ? DBStaffListAll[i]["ImageUrl"]
                                            : "images/defaultImg2.jpg"
                                        }" alt="" />
                                        </div>
                                            ${DBStaffListAll[i]["Bio"]}
                                        </div>
                                    </div>
                                </div>
                            </div>`);
      }

      // if ($('.tempTable').find("tbody").find(`#row${DBStaffList[i]['MbId']}`).length==0) {
      let dayName = new Date(
        DBStaffListAll[i]["AvailableDate"]
      ).toLocaleDateString("en-US", { weekday: "long" });
      $(".tempTable").find("tbody").append(`<tr id="row${
        DBStaffListAll[i]["MbId"]
      }">
                <td>
                    <div class="therapist_name therapist_date" style="${
                      isStaff ? "" : "display:none;"
                    }" day="${dayName}">
                        <h1>${DBStaffListAll[i]["AvailableDate"]}</h1>
                    </div> 
                    <div class="ther_img_name" style="${
                      isStaff ? "display:none;" : ""
                    }">
                        <div class="therapist_pic">
                            <img src="${
                              !!DBStaffListAll[i]["ImageUrl"]
                                ? DBStaffListAll[i]["ImageUrl"]
                                : "images/defaultImg2.jpg"
                            }" alt="" />
                        </div>
                        <div class="therapist_name">
                            <h1>${DBStaffListAll[i]["FirstName"]}</h1>
                            <input type="hidden" class="currentTherapistTear" >
                            ${
                              DBStaffListAll[i]["Bio"] != ""
                                ? `<button type="button" class="btn viwprofile" data-toggle="modal" data-target="#viewprofile${DBStaffListAll[i]["MbId"]}">View profile</button>`
                                : ""
                            }
                        </div>
                    </div>
                </td>
                <td>
                    ${sessionTime}
                </td>
                <td>
					<button type="button" class="btn booknowbtn booknow">Book Now</button>                    
                </td>
            </tr>`);

      if (
        DBStaffListAll[i]["Bio"] != "" &&
        $("body").find(`#viewprofile${DBStaffListAll[i]["MbId"]}`).length == 0
      ) {
        $("body").append(`<div id="viewprofile${
          DBStaffListAll[i]["MbId"]
        }" class="modal fade newmodal" role="dialog">
                                <div class="modal-dialog modal-lg">

                                    <div class="modal-content">
                                        <div class="modal-header">
                                            <button type="button" class="close" data-dismiss="modal">
                                                <img src="images/cancel3.png" alt="" />
                                            </button>
                                            <div class="row">
                                              <div class="col-md-12 text-center">
                                                  <div class="page_name_modal">Profile </div>
                                              </div>
                                            </div>
                                        </div>
                                        <div class="modal-body">
                                        <div class="text-center">
                                        <img class="img-thumbnail" src="${
                                          !!DBStaffListAll[i]["ImageUrl"]
                                            ? DBStaffListAll[i]["ImageUrl"]
                                            : "images/defaultImg2.jpg"
                                        }" alt="" />
                                        </div>
                                            ${DBStaffListAll[i]["Bio"]}
                                        </div>
                                    </div>
                                </div>
                            </div>`);
      }
    }

    $(".tempTable")
      .find("tbody")
      .find("tr")
      .each(function () {
        if ($(this).find("td:nth-child(2)").html().trim()) {
          var rowNode = Table.row
            .add([
              $(this).find("td:nth-child(1)").html(),
              $(this).find("td:nth-child(2)").html(),
            ])
            .draw()
            .node();
          $(rowNode).attr("id", $(this).attr("id"));
        }
      });
  }
}

function addTimmingRows() {
  // console.log('add thereapist row called')
  let places = $(".places").find("input:checked").val();
  if ($.fn.DataTable.isDataTable(".avilable_therapist")) {
    $(".avilable_therapist").DataTable().destroy();
  }
  if ($.fn.DataTable.isDataTable("#avilable_specific_therapist")) {
    $("#avilable_specific_therapist").DataTable().destroy();
  }

  $(".avilable_therapist tbody").empty();
  $("#avilable_sauna_rooms").hide();
  $("#avilable_specific_therapist tbody").empty();
  $(".tempTable").find("tbody").html("");

  let locationOptions = $("body")
    .find("#changelocation")
    .find(".locationsModal .customlocation")
    .closest(`div`);
  let count = 0;
  for (let i = 0; i < locationOptions.length; i++) {
    if (locationOptions[i].style.display != "none") {
      count++;
    }
  }

  // DBStaffList = JSON.parse(DBStaffList);
  let tableBody = $(".avilable_therapist tbody");
  let preference = $("input[name='Preference']:checked").val();

  // console.log(sessionStorage.getItem('tier'));

  if (
    preference == "Specific Therapist" &&
    JSON.parse(sessionStorage.getItem("isTier"))
  ) {
    $(".timeRow").hide();
    $(".specific-preferred-time").show();
    $(".normal-preferred-time").hide();
    $("#avilable_therapist_all_wrapper").hide();
    $("#avilable_therapist_all").hide();
    $("#avilable_therapist").hide();
    $("#avilable_specific_therapist").show();
  } else {
    $(".timeRow").show();
    $("#avilable_therapist").hide();
    $("#avilable_therapist_all_wrapper").hide();
    $("#avilable_specific_therapist").hide();
    $("#avilable_therapist_all").hide();
    if (
      sessionStorage.getItem("showTable") ==
        "#avilable_therapist_all_wrapper" ||
      !JSON.parse(sessionStorage.getItem("isTier"))
    ) {
      $("#avilable_therapist_all_wrapper").show();
      $("#avilable_therapist_all").show();
    } else {
      $("#avilable_therapist").show();
    }
    $(".specific-preferred-time").hide();
    $(".normal-preferred-time").show();
  }
  // console.log(JSON.parse(sessionStorage.getItem('isTier')));
  // Check if DBStaffList is empty
  $("#avilable_specific_therapist thead tr th:nth-child(1)").show();
  if (DBStaffList.length == 0) {
    $("#avilable_specific_therapist thead tr th:nth-child(1)").hide();
    // Create a single row indicating no timings available
    let button = "";
    if ($(".cities").find("input:checked").val() == "151469" && places == 1) {
      button = `<button type="button" class="btn booknowbtn mx-5 noStaffChangelocation" style="width: auto;" >switch to another location </button>`;
    }
    let newRow = $(
      "<tr style='display: flex;justify-content:center;width: 100% !important;'>"
    ).append(
      $("<td colspan='your_column_count'>").html(
        `<div class="row">
                               <div class="col-md-6 col-md-offset-3 col-sm-10 col-sm-offset-1">
                            <div class="no-therapist">
                                <div class="row">
                                    <div class="col-md-12 text-center">
                                    <img src="images/nodata.png" alt="" />
                                    </div>
                                    <div class="col-md-12">
                                       <h2 class="nodatatext"> Your current search resulted in no availability - try broadening your search, or call our office for help with a specific request.</h2>
                                    </div>
                                    <div class="col-md-12 text-center">${button}</div>
                                </div>
                            </div>
                               </div>
                           </div>`
      )
    );
    // Append the row to the table body
    tableBody.append(newRow);
  } else if (
    DBStaffList.length != 0 &&
    preference == "Specific Therapist" &&
    JSON.parse(sessionStorage.getItem("isTier"))
  ) {
    $("#avilable_specific_therapist").show();
    $("#avilable_therapist").hide();
    Table = $("#avilable_specific_therapist").DataTable({
      language: {
        emptyTable: `<div class="row">
                                 <div class="col-md-6 col-md-offset-3 col-sm-10 col-sm-offset-1">
                              <div class="no-therapist">
                                  <div class="row">
                                      <div class="col-md-12 text-center">
                                      <img src="images/nodata.png" alt="" />
                                      </div>
                                      <div class="col-md-12">
                                         <h2 class="nodatatext"> We're sorry, no therapists are available at this time.</h2>
                                      </div>
                                      ${
                                        count > 1
                                          ? '<div class="col-md-12 text-center"><button type="button" class="btn booknowbtn mx-5 noStaffChangelocation" style="width: auto;" >switch to another location </button></div>'
                                          : ""
                                      }
                                  </div>
                              </div>
                                 </div>
                             </div>`,
      },
      responsive: false,
      bLengthChange: false,
      bInfo: false,
      bAutoWidth: false,
      searchable: false,
      columnDefs: [{ searchable: false, targets: 0 }],
    });
    for (var i = 0; i < DBStaffList.length; i++) {
      var sessionTime = DBStaffList[i]["AvailabilitiesOption"];
      let dayName = new Date(
        DBStaffList[i]["AvailableDate"]
      ).toLocaleDateString("en-US", { weekday: "long" });
      $(".tempTable").find("tbody")
        .append(`<tr id="row${DBStaffList[i]["MbId"]}">
                <td>
                    <div class="therapist_name therapist_date" day="${dayName}">
                        <h1>${DBStaffList[i]["AvailableDate"]}</h1>
                    </div>
                </td>
                <td>
                    ${sessionTime}
                </td>
            </tr>`);
    }

    $(".tempTable")
      .find("tbody")
      .find("tr")
      .each(function () {
        if ($(this).find("td:nth-child(2)").html().trim()) {
          var rowNode = Table.row
            .add([
              $(this).find("td:nth-child(1)").html(),
              $(this).find("td:nth-child(2)").html(),
            ])
            .draw()
            .node();
          $(rowNode).attr("id", $(this).attr("id"));
        }
      });
  } else {
    // Iterate through the AJAX response data
    DBStaffList.forEach(function (response) {
      // Create a new row for each appointment
      let newRow = $("<tr style='display: flex;justify-content:center;'>");
      // Append the response data to the new row
      newRow.append($("<td>").html(response));
      // Append the new row to the table body
      tableBody.append(newRow);
    });
  }
}

function addSaunaTimmingRows() {
  // Destroy existing DataTables if present
  if ($.fn.DataTable.isDataTable(".avilable_therapist")) {
    $(".avilable_therapist").DataTable().destroy();
  }
  if ($.fn.DataTable.isDataTable("#avilable_sauna_rooms")) {
    $("#avilable_sauna_rooms").DataTable().destroy();
  }

  // Clear all old data
  $(
    ".avilable_therapist tbody, #avilable_specific_therapist tbody, .tempTable tbody"
  ).empty();

  // Count visible locations (for switch button visibility)
  let locationOptions = $(
    "#changelocation .locationsModal .customlocation"
  ).closest("div");
  let visibleCount = locationOptions.filter(function () {
    return $(this).is(":visible");
  }).length;

  // Get checked place & preference
  let places = $(".places").find("input:checked").val();
  let preference = $("input[name='Preference']:checked").val();

  // Hide all tables except sauna one
  $(".timeRow, .normal-preferred-time").show();
  $(".dont-see-time").parent().parent().hide();
  $(".filterOption").hide();
  $(
    ".specific-preferred-time, .preferenceTimeRow, #avilable_therapist, #avilable_specific_therapist, #avilable_therapist_all, #avilable_therapist_all_wrapper"
  ).hide();
  $("#avilable_sauna_rooms").show();

  // Target sauna table body
  let saunaTableBody = $("#avilable_sauna_rooms tbody");
  saunaTableBody.empty();

  // If no availability
  if (!DBStaffList || DBStaffList.length === 0) {
    saunaTableBody.append(`
      <tr style="display:flex; justify-content:center; width:100% !important;">
        <td colspan="2">
          <div class="row">
            <div class="col-md-6 col-md-offset-3 col-sm-10 col-sm-offset-1">
              <div class="no-therapist text-center">
                <img src="images/nodata.png" alt="" />
                <h2 class="nodatatext">
                  Your current search resulted in no availability – try broadening your search, or call our office for help with a specific request.
                </h2>
              </div>
            </div>
          </div>
        </td>
      </tr>
    `);
    return;
  }

  // Iterate through the AJAX response data
  DBStaffList.forEach(function (response) {
    // Create a new row for each appointment
    let newRow = $("<tr style='display: flex;justify-content:center;'>");
    // Append the response data to the new row
    newRow.append($("<td>").html(response));
    // Append the new row to the table body
    saunaTableBody.append(newRow);
  });
}

function availabilities(siteid, locationId, sessionId, startDate, endDate) {
  window.scrollTo(0, 0);
  $(".loader-appointment").show();
  let placeId = $(".places").find("input:checked").val();
  checkTherapistFromDB(
    placeId,
    siteid,
    locationId,
    sessionId,
    startDate,
    endDate
  );
}

function checkTherapistFromDB(
  placeId,
  siteid,
  locationId,
  sessionId,
  startDate,
  endDate
) {
  var pressureId = "";
  let category = $(".customizations").find("input:checked").val().trim();
  pressureId = $(".typeOfPressure").val();
  if (
    $(".customizations").find("input:checked").val().trim() == "Sauna Session"
  ) {
    sessionId = $(".saunas").find("input:checked").val();
  } else {
    $(".filterOption").show();
  }

  var specialPregAccomId = $("body")
    .find("input[name='pregnant']:checked")
    .val();
  var specialMinorAccomId = $("body").find("input[name='minor']:checked").val();
  let tierSelected =
    $("#Dropdown").find('input[name="radio-group"]:checked').val() ==
    "Specific Therapist"
      ? 0
      : $("body").find("input[name='Tier']:checked").val();
  const gender = $(".cust_filter_gender")
    .find("input[name='radio-group']:checked")
    .val();
  if (
    $("#Dropdown").find('input[name="radio-group"]:checked').val() ==
      "Specific Therapist" &&
    JSON.parse(sessionStorage.getItem("isTier"))
  ) {
    startDate = $(".weeks").find(".slick-active").find(".week").attr("date");
    endDate = $(".weeks").find(".slick-active").find(".week").attr("enddate");
  }

  // console.log(sessionId);
  $.ajax({
    url: url + "/endPoints.php",
    method: "post",
    data: {
      function: "checkTherapistFromDB",
      tier: tierSelected,
      placeId: placeId,
      siteid: siteid,
      LocationIds: locationId,
      category: category,
      SessionTypeIds: sessionId,
      PressureTypeIds: pressureId,
      specialPregAccomId: specialPregAccomId,
      specialMinorAccomId: specialMinorAccomId,
      gender: gender,
      StartDate: startDate,
      EndDate: endDate,
      StaffId:
        $("#Dropdown").find('input[name="radio-group"]:checked').val() ==
        "Specific Therapist"
          ? $(".PreferenceStaffSelect").val()
          : null,
      TimeToFilter: $("body").find('input[name="timings"]:checked').val(),
    },
    success: function (data) {
      data = JSON.parse(data);
      DBStaffList = data.uniqueTimings;
      DBStaffListAll = data.AvailabilitiesTherapistOption;
      // DBStaffListAll = Array.from(
      //     new Map(data.AvailabilitiesTherapistOption.map(item => [item.MbId, item])).values()
      //   );
      if (
        $(".customizations").find("input:checked").val().trim() ==
        "Sauna Session"
      ) {
        addSaunaTimmingRows();
      } else {
        addTherapistRows();
        addTimmingRows();
      }
      $(".pressureContent").hide();
      $(".preferenceContent").hide();
      $(".availabilityContent").show();
      $(".loader-appointment").hide();
    },
  });
}

function accounts() {
  window.scrollTo(0, 0);
  logs({
    from: "BookingPopup",
    function: "clients",
    siteid: $(".locations").find("input:checked").val(),
    SearchText: "",
  });
  $.ajax({
    url: url + "/endPoints.php",
    method: "post",
    data: {
      function: "clients",
      siteid: $(".locations").find("input:checked").val(),
      SearchText: "",
    },
    success: function (data) {
      var clients = JSON.parse(data);
      // console.log(clients);
      if ($(".profile").is(":visible") && clients.length > 0) {
        if (clients.length > 0) {
          let html = "";
          let accountCount = 0;
          for (let i = 0; i < clients.length; i++) {
            if (
              clients[i]["SiteID"] ==
                ($(".locations").find("input:checked").val() == "0"
                  ? 151469
                  : 151471) &&
              (!clients[i]["ReportedAccount"] ||
                clients[i]["ReportedAccount"] == "0")
            ) {
              accountCount++;
              html =
                html +
                `<div class="row">
                                <div class="col-lg-12 mt-10">
                                    <div class="d-flex align-items-center" id="${clients[i]["MbId"]}">
                                        <h6 style="min-width: 160px;max-width: 160px;"><strong>${clients[i]["FirstName"]} ${clients[i]["LastName"]}</strong></h6>
                                        <button type="button" class="radiobutton mr-2 bookUsingThisUser">Book Using This Account</button>
                                        <button type="button" class="report reportconfirm" mbid="${clients[i]["MbId"]}">Report this Account</button>
                                    </div>
                                </div>
                            </div>`;
            }
          }
          if (accountCount > 1) {
            $(".SuppressAccountContent").html(html);
            $("#SuppressAccount").modal("show");
            $(".loader").hide();
          } else {
            if ($(".places").find("input:checked").val() == 1) {
              addAppointment();
            } else {
              var locationValue = $(".locations").find("input:checked").val();
              var targetSiteID = locationValue == "0" ? 151469 : 151471;
              var filteredClients = clients.filter(function (client) {
                return client.SiteID == targetSiteID;
              });
              // $("#booknow").modal("hide");
              // $(".sessionContent").hide();
              // $(".availabilityContent").hide();
              $(".bookNowContent").hide();
              $(".paymentPageContent").show();
              $(".payBookAppointmentBtn").attr(
                "data-cid",
                filteredClients[0].MbId
              );
              $(".payBookAppointmentBtn").attr(
                "data-cname",
                filteredClients[0].FirstName
              );
              $(".payBookAppointmentBtn").attr(
                "data-cmail",
                filteredClients[0].Email
              );
              $(".loader").hide();
              checkClientCreditCard(
                $(".cities").find("input:checked").val(),
                filteredClients[0].MbId
              );
            }
          }
        }
      } else {
        $(".loader").hide();
      }
    },
  });
}

$(document).ready(function () {
  $("#memcontent").hide(1000);
  $("#haveMembershipContent").hide(1000);
  $("#showMembership").click(function () {
    $("#yesno").hide();
    $("#haveMembershipContent").hide(1000);
    $("#memcontent").show(1000);
  });

  $("#haveMembership").click(function () {
    $("#yesno").hide();
    $("#memcontent").hide(1000);
    $("#haveMembershipContent").show(1000);
  });

  $("body").on("click", ".gplogin, .googlenew", function () {
    $(".nsm7Bb-HzV7m-LgbsSe-MJoBVe").trigger("click");
  });

  function getStaff(tier = 0) {
    let pregnant = null;
    let minor = null;
    let pressure = null;
    let session = null;
    if ($("input[name='pregnant']:checked").length) {
      pregnant = $("input[name='pregnant']:checked").val();
    }
    if ($("input[name='minor']:checked").length) {
      minor = $("input[name='minor']:checked").val();
    }
    if ($("input[name='pressure10']:checked").length) {
      pressure =
        $("input[name='pressure10']:checked").val() ??
        $(".typeOfPressure").val();
    }
    if ($('input[name="Session"]:checked').length) {
      session = $('input[name="Session"]:checked').val();
    }
    $.ajax({
      url: url + "/endPoints.php",
      method: "post",
      data: {
        function: "staffListBySiteId",
        siteid: $(".cities").find("input:checked").val(),
        location: $(".locations").find("input:checked").data("id"),
        session: session,
        pressure: pressure,
        pregnant: pregnant,
        minor: minor,
        tier: tier,
      },
      success: function (data) {
        $("#specificTherapistList").find(".staffList").html("");
        var staffs = JSON.parse(data);
        let html;
        for (let i = 0; i < staffs.length; i++) {
          if (i == 0) {
            html = `<option value="${staffs[i]["MbId"]}" imageurl="${
              staffs[i]["ImageUrl"]
            }" bio="${staffs[i]["Bio"] && "yes"}">${staffs[i]["FirstName"]} ${
              staffs[i]["LastName"]
            }</option>`;
          } else {
            html += `<option value="${staffs[i]["MbId"]}" imageurl="${
              staffs[i]["ImageUrl"]
            }" bio="${staffs[i]["Bio"] && "yes"}">${staffs[i]["FirstName"]} ${
              staffs[i]["LastName"]
            }</option>`;
          }
        }
        $("#specificTherapistList").find(".staffList").html(html);
        $("#dropdownStaffList").html(html);
        getStaffBySiteLocation();
        $("#specificTherapistList").find(".staffList").val("");
        // also add in filter dropdown
        $("#dropdownStaffList").val("");
        $(".loader").hide();
      },
    });
  }

  function getStaffBySiteLocation() {
    $.ajax({
      url: url + "/endPoints.php",
      method: "post",
      data: {
        function: "staffBySiteLocationId",
        siteid: $(".cities").find("input:checked").val(),
        location: $(".locations").find("input:checked").data("id"),
      },
      success: function (data) {
        var staffs = JSON.parse(data);
        let html = '<option value=""> Select </option>';
        for (let i = 0; i < staffs.length; i++) {
          html += `<option value="${staffs[i]["MbId"]}" imageurl="${
            staffs[i]["ImageUrl"]
          }" bio="${staffs[i]["Bio"] && "yes"}">${staffs[i]["FirstName"]} ${
            staffs[i]["LastName"]
          }</option>`;
        }
        $("#availableStaffList").html(html);
      },
    });
  }

  //1 code for from first scrren click next
  $("body").on("click", "#newAccountCreate", function (e) {
    e.preventDefault();
    // Validation for required fields
    // console.log("1");
    // let firstName = $("#newUserFirstName").val().trim();
    // let lastName = $("#newUserLastName").val().trim();
    // let email = $("#newUserEmail").val().trim();
    // let mobilePhone = $("#newUserMobilePhone").val().trim();
    // console.log("2");
    // if (
    //   firstName === "" ||
    //   lastName === "" ||
    //   email === "" ||
    //   mobilePhone === ""
    // ) {
    //   $("#newAccountErrorMsg").text("Please enter user details").show();
    //   return;
    // }

    // // Additional validation for email format
    // if (!validateEmail(email)) {
    //   $("#newAccountErrorMsg").text("Please enter valid email").show();
    //   return;
    // }

    $("#newAccountErrorMsg").text("").hide();

    // Set values to hidden input field attributes
    $("#clientDetailType").attr("clientFirst", $("#newUserFirstName").val());
    $("#clientDetailType").attr("clientLast", $("#newUserLastName").val());
    $("#clientDetailType").attr("clientEmail", $("#newUserEmail").val());
    $("#clientDetailType").attr("clientMobile", $("#newUserMobilePhone").val());
    $("#clientDetailType").attr("clientType", "new-account");

    // places();
    cities();
    $("#loginFormStartUp").hide();
    window.scrollTo(0, 0);
    $("#le_section-eight").show();
  });

  $(".weeks").slick({
    prevArrow:
      '<button type="button" data-role="none" class="slick-prev" style="left: -20px !important"><img src="images/left.png"></button>',
    nextArrow:
      '<button type="button" data-role="none" class="slick-next" style="right: -20px !important"><img src="images/right.png"></button>',
    dots: false,
    infinite: false,
    speed: 300,
    slidesToShow: 1,
    slidesToScroll: 1,
    responsive: [
      {
        breakpoint: 1024,
        settings: {
          slidesToShow: 1,
          slidesToScroll: 1,
        },
      },
      {
        breakpoint: 600,
        settings: {
          slidesToShow: 1,
          slidesToScroll: 1,
        },
      },
      {
        breakpoint: 480,
        settings: {
          slidesToShow: 1,
          slidesToScroll: 1,
        },
      },
    ],
  });

  $("body").on("click", ".memberPrevBtn", function () {
    window.scrollTo(0, 0);
    $("#membership").modal("hide");
    $("#booknow").modal("show");
    $(".home-page").addClass("modal-open");
  });

  $("body").on("change", "input[name='Preference']", function () {
    if ($(this).val() === "Specific Therapist") {
      $(".PreferenceStaffSelect").closest(".row").show();
    } else {
      $(".PreferenceStaffSelect").closest(".row").hide();
    }
  });

  $(".datepicker").datepicker({
    changeMonth: true,
    changeYear: true,
    yearRange: "1920:2021",
  });

  $(".dropdown-submenu a.dropdown-submenu-toggle").on("click", function (e) {
    $(".dropdown-submenu ul").removeAttr("style");
    $(this).next("ul").toggle();
    e.stopPropagation();
    e.preventDefault();
  });

  $("#bs-navbar-collapse-1").on("hidden.bs.dropdown", function () {
    $(".navbar-nav .dropdown-submenu ul.dropdown-menu").removeAttr("style");
  });

  $(".slider").on("afterChange", function () {
    // var monthOf = (parseInt($(".slick-active").length/2)==0 ? 1 : parseInt($(".slick-active").length/2));
    var monthOf = parseInt($(".slick-active").length / 2);
    $(".slick-active").each(function (index) {
      if (index == monthOf) {
        $(".month")
          .find("h3")
          .text(
            monthNames[
              parseInt($(this).find(".day").attr("date").split("-")[1]) - 1
            ]
          );
      }
    });
  });

  $(".weeks").on("afterChange", function () {
    $(".weekCalHead")
      .find("h3:nth-child(2)")
      .text($(this).find(".slick-active").find(".week").attr("allYears"));
    availabilities(
      $(".locations").find("input:checked").val(),
      $(".locations").find("input:checked").attr("data-id"),
      $(".sessions").find("input:checked").val(),
      $(".weeks").find(".slick-active").find(".week").attr("date"),
      $(".weeks").find(".slick-active").find(".week").attr("enddate")
    );
    logs({
      from: "WeeksChage",
      siteid: $(".locations").find("input:checked").val(),
      LocationIds: $(".locations").find("input:checked").attr("data-id"),
      SessionTypeIds: $(".sessions").find("input:checked").val(),
      PressureTypeIds: $(".pressures")
        .find("input[name='pressure10']:checked")
        .val(),
      specialPregAccomId: $("body")
        .find("input[name='pregnant']:checked")
        .val(),
      specialMinorAccomId: $("body").find("input[name='minor']:checked").val(),
      gender: $("input[name='Preference']:checked").val(),
      StartDate: $(".weeks").find(".slick-active").find(".week").attr("date"),
      EndDate: $(".weeks").find(".slick-active").find(".week").attr("enddate"),
      StaffId:
        $("#Dropdown").find('input[name="radio-group"]:checked').val() ==
        "Specific Therapist"
          ? $("#dropdownStaffList").val()
          : null,
      TimeToFilter: $("body").find('input[name="timings"]:checked').val(),
    });
  });

  $("body").on("click", ".resendOtp", function () {
    if ($(this).closest(".modal").find(".timeout").text() == "00:00") {
      var siteid = $(".locations").find("input:checked").val();
      var email = $("#signinEmail").val();
      clients(siteid, email, "sendmail");
    }
  });

  $(".days").slick({
    prevArrow:
      '<button type="button" data-role="none" class="slick-prev"><img src="images/left.png"></button>',
    nextArrow:
      '<button type="button" data-role="none" class="slick-next"><img src="images/right.png"></button>',
    dots: false,
    infinite: false,
    speed: 300,
    slidesToShow: 7,
    slidesToScroll: 7,
    responsive: [
      {
        breakpoint: 1024,
        settings: {
          slidesToShow: 3,
          slidesToScroll: 3,
        },
      },
      {
        breakpoint: 600,
        settings: {
          slidesToShow: 2,
          slidesToScroll: 2,
        },
      },
      {
        breakpoint: 480,
        settings: {
          slidesToShow: 1,
          slidesToScroll: 1,
        },
      },
    ],
  });

  let monthAarrayCount = [];
  for (
    var i = 1;
    i <= $("body").find(".days").find(".slick-active").length;
    i++
  ) {
    let mmmmm = $("body")
      .find(`.slick-active:nth-child(${i})`)
      .find(".day")
      .attr("date")
      .split("-")[1];
    monthAarrayCount.push(mmmmm);
  }
  $(".month")
    .find("h3")
    .text(monthNames[getHigerOccElement(monthAarrayCount) - 1]);

  $("body").on("click", ".checkEmail", function (e) {
    var siteid = $(".locations").find("input:checked").val();
    var email = $("#email").val();
    if (email != "" && validateEmail(email)) {
      clients(siteid, email, "create");
    } else {
      $(".mailEroSignup").text("Please enter valid Email.");
      $(".mailEroSignup").fadeIn(300).delay(5000).fadeOut(300);
      $("#email").prop("required", true);
    }
  });

  $("body").on("click", ".signinBtn", function (e) {
    var siteid = $(".locations").find("input:checked").val();
    var email = $("#signinEmail").val();

    if (validateEmail(email)) {
      if (!$(".otp").is(":visible")) {
        checkSignIn(siteid, email, "sendmail");
      } else {
        clients(siteid, email, "signin");
      }
    } else {
      $("#signinEmail").prop("required", true);
      $(".mailEroSignin").fadeIn("Please enter valid Email.");
      $(".mailEroSignin").fadeIn(300).delay(5000).fadeOut(300);
    }
  });

  function checkappoitnmentStaff() {
    $.ajax({
      url: url + "/endPoints.php",
      method: "post",
      data: {
        function: "checkAndBookTherapistAvailability",
        tier: tierSelected,
        siteid: siteid,
        LocationIds: locationId,
        SessionTypeIds: sessionId,
        PressureTypeIds: pressureId,
        specialPregAccomId: specialPregAccomId,
        specialMinorAccomId: specialMinorAccomId,
        gender: gender,
        StartDate: startDate,
        EndDate: endDate,
        StaffId:
          $("#Dropdown").find('input[name="radio-group"]:checked').val() ==
          "Specific Therapist"
            ? $("#dropdownStaffList").val()
            : null,
        TimeToFilter: $("body").find('input[name="timings"]:checked').val(),
      },
      success: function (data) {
        // console.log(data);
      },
    });
  }

  $("body").on("click", ".bookNowApptBtn", function (e) {
    // Get the value of staffids attribute
    if (
      $("#Dropdown").find('input[name="radio-group"]:checked').val() ==
      "Specific Therapist"
    ) {
      const staffList = $(".staffListFilter").val() ?? [];
      if (staffList.length == 0) {
        if (!$(".dropdown").hasClass("open")) {
          $("#dropdownMenu1").click();
        }
        setTimeout(() => {
          $(".filterOption .preferenceRequireeStaffErr")
            .fadeIn(300)
            .delay(5000)
            .fadeOut(300);
        }, 500);
        return false;
      }
    }
    let staffids = $(this).attr("staffids");
    const timeText = $(this).prev(".aptTime").text();
    const fromDateTime = $(this).attr("from");
    const bookType = $(this).data("value");
    // Extract date portion and format it
    const dateObj = new Date(fromDateTime);
    const options = { year: "numeric", month: "short", day: "numeric" };
    const formattedDate = dateObj
      .toLocaleDateString("en-US", options)
      .replace(",", "");

    // Combine and show
    $("#userSelectedTime").text(`${formattedDate}, ${timeText}`);
    $("#userSelectedTime").attr("from", $(this).attr("from"));
    $("#userSelectedTime").attr("to", $(this).attr("to"));
    $("#userSelectedTime").attr("staffIds", $(this).attr("staffids"));
    $(".staffIdForCheckBooking").val(staffids);
    $(".availabilityContent").hide();
    $(".sessionContent").hide();
    if (
      $(".customizations").find("input:checked").val().trim() == "Sauna Session"
    ) {
      $("#summaryLocation").show();
      $("#summaryLocation span").text(
        $(".locations")
          .find("input:checked")
          .closest(".customlocation")
          .find(".locationaddress")
          .text()
      );
      $("#summaryExpectation").show();
      $("#summaryAreaOfFocus").hide();
      $("#summaryAromatherapy").hide();
    } else {
      $("#summaryLocation").hide();
      $("#summaryExpectation").hide();
      $("#summaryAreaOfFocus").show();
      $("#summaryAromatherapy").show();
    }
    $(".bookNowContent").show();
    $('input[name="isRequested"]').prop("checked", false);
    if (bookType == "old") {
      $("#confirmRequestTherapist").show();
      $("#therapistImgView").attr("src", $(this).attr("staffImage"));
      $("#therapistNameTitle").text($(this).attr("staffName"));
      sessionStorage.setItem("isOldBook", true);
    } else {
      $("#confirmRequestTherapist").hide();
      sessionStorage.setItem("isOldBook", false);
    }

    if ($(".dropdown").hasClass("open")) {
      $("#dropdownMenu1").click();
    }

    if (
      $("#Dropdown").find('input[name="radio-group"]:checked').val() ==
      "Specific Therapist"
    ) {
      getPrice(
        $(".locations").find("input:checked").val(),
        $(".sessions").find("input:checked").val(),
        $(".PreferenceStaffSelect option:selected").text()
      );
      $('input[name="isRequested"]').prop("checked", true);
      $("#requestedTherapistDiv").hide();
    } else {
      $("#requestedTherapistDiv").show();
    }
    activityLogs({
      from: "selectSlotFromAvaiableSlot",
      siteid: $(".locations").find("input:checked").val(),
      locationId: $(".locations").find("input:checked").attr("data-id"),
      sessionTypeId: $(".sessions").find("input:checked").val(),
      tier: $('input[name="Tier"]:checked').val(),
      selectedTime: $("#userSelectedTime").text(),
      startDateTime: $("#userSelectedTime").attr("from"),
      endDateTime: $("#userSelectedTime").attr("to"),
      staffIds: $("#userSelectedTime").attr("staffIds"),
    });
  });

  $("body").on("click", ".booknow", function (e) {
    // alert("yes");
    let name = $(this)
      .closest("tr")
      .find(".ther_img_name .therapist_name")
      .find("h1")
      .text();
    $(this).closest("tbody").find("tr").removeClass("selectedTherapist");
    $(this).closest("tr").addClass("selectedTherapist");
    var StaffId = $(this).closest("tr").attr("id").slice(3);
    $(".staffIdForCheckBooking").val(StaffId);
    $("#booknow").find("#userSelectedTime").attr("staffIds", StaffId);
    $("#booknow")
      .find(".therapist_pic")
      .find("img")
      .attr(
        "src",
        $(this).closest("tr").find(".therapist_pic").find("img").attr("src")
      );
    $("#booknow").find(".therapist_name").find("h1").text(name);
    $("#booknow").find("#preferredtime").html("");
    $("#booknow").find("#preferredtime").show();
    $("#booknow").modal("show");

    $(this)
      .closest("tr")
      .find("td:nth-child(2)")
      .find("span")
      .each(function () {
        $("#booknow")
          .find("#preferredtime")
          .append(
            `<option from="${$(this).attr("from")}" to="${$(this).attr(
              "to"
            )}">${$(this).text()}</option>`
          );
      });

    getPrice(
      $(".locations").find("input:checked").val(),
      $(".sessions").find("input:checked").val(),
      $(".PreferenceStaffSelect option:selected").text()
    );

    let option = $("#preferredtime option:selected");
    let from = option.attr("from");
    let to = option.attr("to");
    $("#userSelectedTime").attr("from", from);
    $("#userSelectedTime").attr("to", to);
    $("#userSelectedTime").text($("#preferredtime").val());

    activityLogs({
      from: "BookNow",
      siteid: $(".locations").find("input:checked").val(),
      locationId: $(".locations").find("input:checked").attr("data-id"),
      sessionTypeId: $(".sessions").find("input:checked").val(),
      staffId: $(".selectedTherapist").attr("id").slice(3),
      srtartDateTime: $("#preferredtime option:selected").attr("from"),
      endDateTime: $("#preferredtime option:selected").attr("to"),
    });
  });

  $(".area-focus").change(function () {
    if ($(this).val() === "Specific Areas") {
      $("#specific-area-list").css("display", "block");
      $("#other-area").css("display", "none");
    } else if ($(this).val() === "Other") {
      $("#other-area").css("display", "block");
      $("#specific-area-list").css("display", "none");
    } else {
      $("#specific-area-list").css("display", "none");
    }
  });

  // Function to select all checkboxes in the "Specific Areas" section
  function selectAllCheckboxes() {
    $('.specific-areas input[type="checkbox"]').prop("checked", true);
  }

  // Function to deselect all checkboxes in the "Specific Areas" section
  function deselectAllCheckboxes() {
    $('.specific-areas input[type="checkbox"]').prop("checked", false);
  }

  // Event handler for the "Select All" checkbox
  $("#select-all-checkbox").change(function () {
    if ($(this).is(":checked")) {
      selectAllCheckboxes();
    } else {
      deselectAllCheckboxes();
    }
  });

  $("body").on("click", ".slick-next", function (e) {
    const screenWidth = window.innerWidth;
    // Check if the screen width is 480px or less
    if (screenWidth <= 480) {
      setTimeout(function () {
        $(".slick-slide.slick-current.slick-active .day").click();
      }, 1000);
    }
  });

  $("body").on("click", ".slick-prev", function (e) {
    const screenWidth = window.innerWidth;
    // Check if the screen width is 480px or less
    if (screenWidth <= 480) {
      setTimeout(function () {
        $(".slick-slide.slick-current.slick-active .day").click();
      }, 1000);
    }
  });

  $("body").on("click", ".day", function (e) {
    $("body").find(".day").removeClass("selectedDay");
    $(this).addClass("selectedDay");
    availabilities(
      $(".locations").find("input:checked").val(),
      $(".locations").find("input:checked").attr("data-id"),
      $(".sessions").find("input:checked").val(),
      $(".selectedDay").attr("date"),
      $(".selectedDay").attr("date")
    );

    logs({
      from: "DaysChage",
      siteid: $(".locations").find("input:checked").val(),
      LocationIds: $(".locations").find("input:checked").attr("data-id"),
      SessionTypeIds: $(".sessions").find("input:checked").val(),
      PressureTypeIds: $(".pressures")
        .find("input[name='pressure10']:checked")
        .val(),
      specialPregAccomId: $("body")
        .find("input[name='pregnant']:checked")
        .val(),
      specialMinorAccomId: $("body").find("input[name='minor']:checked").val(),
      gender: $("input[name='Preference']:checked").val(),
      StartDate: $(".selectedDay").attr("date"),
      EndDate: $(".selectedDay").attr("date"),
      StaffId:
        $("#Dropdown").find('input[name="radio-group"]:checked').val() ==
        "Specific Therapist"
          ? $("#dropdownStaffList").val()
          : null,
      TimeToFilter: $("body").find('input[name="timings"]:checked').val(),
    });
  });

  $(".pressure_text").click(function () {
    $(this)
      .closest(".pressuretype")
      .find(".pressure_contect")
      .addClass("showcontent");
  });

  $(".close_pressure").click(function () {
    $(this)
      .closest(".pressuretype")
      .find(".pressure_contect")
      .removeClass("showcontent");
  });

  $("body").on("click", ".reportconfirm", function () {
    let id = $(this).closest("div").attr("id");
    let text = $(this).closest("div").find("h6").text();
    $.ajax({
      url: url + "/endPoints.php",
      method: "post",
      data: {
        function: "getNotReportAccount",
        id: id,
        siteid: $(".locations").find("input:checked").val(),
      },
      success: function (data) {
        data = JSON.parse(data);
        $(".loader").hide();
        if (data.data.length > 1) {
          $(".suspiciousAccountYes").attr("id", id);
          $(".suspiciousAccountName").text(text);
          $("#reportconfirmpopup").modal("show");
        } else {
          $("#SuppressAccount").find(".errorMsg").show();
        }
      },
    });
  });

  $("body").on("click", ".bookUsingThisUser", function () {
    $(".loader").show();
    addAppointment($(this).closest("div").attr("id"), "");
  });

  $("body").on("click", ".suspiciousAccountYes", function () {
    // $(this).attr('id');
    let id = $(this).attr("id");
    $(".loader").show();
    $.ajax({
      url: url + "/endPoints.php",
      method: "post",
      data: {
        function: "reportAccount",
        id: id,
        siteid: $(".locations").find("input:checked").val(),
      },
      success: function (data) {
        // data = (JSON.parse(data.split("breack")[1]));
        $(".loader").hide();
        // if(data.data){
        $(".SuppressAccountContent")
          .find("#" + id)
          .find("button")
          .prop("disabled", true);
        $("#reportconfirmpopup").modal("hide");
        // }else{
        //     $("#reportconfirmpopup").find(".errorMsg").show();
        // }
      },
    });
  });

  // pop up data get for booking
  $("#Continuous").click(function () {
    if (
      !$("#booknow").find("input[name='area-focus']:checked").length &&
      $(".customizations").find("input:checked").val().trim() != "Sauna Session"
    ) {
      $("#booknow")
        .find(".areaFocusErrorMsg")
        .fadeIn(300)
        .delay(5000)
        .fadeOut(300);
      return;
    } else if (
      !$("#booknow").find("input[name='oil-radio']:checked").length &&
      $(".customizations").find("input:checked").val().trim() != "Sauna Session"
    ) {
      $("#booknow").find(".oilErrorMsg").fadeIn(300).delay(5000).fadeOut(300);
      return;
    } else {
      let areaFocusSelected = $("#booknow")
        .find("input[name='area-focus']:checked")
        .val();
      if (areaFocusSelected == "Specific Areas") {
        if ($('input[name="specific-areas"]:checked').length === 0) {
          $("#booknow")
            .find(".specificAreasErrorMsg")
            .fadeIn(300)
            .delay(5000)
            .fadeOut(300);
          return;
        }
      } else if (areaFocusSelected == "Other") {
        if ($("#otherArea").val().trim() == "") {
          $("#booknow")
            .find(".otherAreasErrorMsg")
            .fadeIn(300)
            .delay(5000)
            .fadeOut(300);
          return;
        }
      }
      //call appointment Booking start with logs
      // $(".loader").show();
      let docNotes = "";
      let arrayNotes = [];

      if ($("#promocode").val() !== "") {
        arrayNotes.push("Promo Code - " + $("#promocode").val());
        docNotes = "Promo Code - " + $("#promocode").val();
      }

      if (areaFocusSelected == "Specific Areas") {
        let specificAreas = [];
        // Iterate through all specific areas checkboxes
        $('input[name="specific-areas"]:checked').each(function () {
          specificAreas.push($(this).val());
        });
        // Join the specific areas array values with comma separator
        let specificAreasString = specificAreas.join(", ");
        if (specificAreasString !== "") {
          arrayNotes.push("Focus: Specific Areas - " + specificAreasString);
          docNotes =
            docNotes + "\nFocus: Specific Areas - " + specificAreasString;
        }
      } else if (areaFocusSelected == "Other") {
        let otherString = $("#otherArea").val();
        arrayNotes.push("Focus Area: " + otherString);
        docNotes = docNotes + "\nFocus Area: " + otherString;
      } else {
        arrayNotes.push("Focus - Full Body");
        docNotes = docNotes + "\nFocus - Full Body";
      }

      let pregnantlength = $(".filterOption").find(
        "input[name='pregnant']:checked"
      ).length;
      let pregnantName = $(".filterOption")
        .find("input[name='pregnant']:checked")
        .hasClass("pregnant")
        ? "Pregnant"
        : "Minor";
      let pregnantAge = $(".filterOption")
        .find("input[name='pregnant']:checked")
        .closest("div")
        .find("input[type='number']")
        .val();

      if (pregnantlength && pregnantAge != "") {
        let monthYear =
          pregnantAge != 1
            ? (pregnantName == "Pregnant" ? "month" : "year") + "s"
            : pregnantName == "Pregnant"
            ? "month"
            : "year";
        arrayNotes.push(pregnantName + " - " + pregnantAge + " " + monthYear);
        docNotes =
          docNotes +
          "\n" +
          pregnantName +
          " - " +
          pregnantAge +
          " " +
          monthYear;
      } else if (pregnantlength) {
        arrayNotes.push(pregnantName + " - ");
        docNotes = docNotes + "\n" + pregnantName + " - ";
      }

      let minorlength = $(".filterOption").find(
        "input[name='minor']:checked"
      ).length;
      let minorName = $(".filterOption")
        .find("input[name='minor']:checked")
        .hasClass("pregnant")
        ? "Pregnant"
        : "Minor";
      let minorAge = $(".filterOption")
        .find("input[name='minor']:checked")
        .closest("div")
        .find("input[type='number']")
        .val();

      if (minorlength && minorAge != "") {
        let monthYear =
          minorAge != 1
            ? (minorName == "Pregnant" ? "month" : "year") + "s"
            : minorName == "Pregnant"
            ? "month"
            : "year";
        arrayNotes.push(minorName + " - " + minorAge + " " + monthYear);
        docNotes =
          docNotes + "\n" + minorName + " - " + minorAge + " " + monthYear;
      } else if (minorlength) {
        arrayNotes.push(minorName + " - ");
        docNotes = docNotes + "\n" + minorName + " - ";
      }

      if ($(".typeOfPressure").val() != "") {
        arrayNotes.push(
          "Massage - " + $(".typeOfPressure option:selected").text()
        );
        docNotes =
          docNotes +
          "\nMassage - " +
          $(".typeOfPressure option:selected").text();
      }

      if ($("input[name='Preference']").is(":checked")) {
        if (
          $("input[name='Preference']:checked").val().trim() !=
          "Specific Therapist"
        ) {
          arrayNotes.push(
            "Gender Preference: " + $("input[name='Preference']:checked").val()
          );
          docNotes =
            docNotes +
            "\nGender Preference: " +
            $("input[name='Preference']:checked").val();
        }
      }

      if ($("#booknow").find("input[name='oil-radio']").is(":checked")) {
        arrayNotes.push(
          "Essential Oil: " +
            $("#booknow").find("input[name='oil-radio']:checked").val()
        );
        docNotes =
          docNotes +
          "\nEssential Oil: " +
          $("#booknow").find("input[name='oil-radio']:checked").val();
      }

      let tierSelection = $("body").find("input[name='Tier']:checked").val();
      arrayNotes.push(
        "Tier selected: " +
          (tierSelection == 0 ? "No Tier Preference" : "Tier " + tierSelection)
      );
      docNotes =
        docNotes +
        "\nTier selected: " +
        (tierSelection == 0 ? "No Tier Preference" : "Tier " + tierSelection);

      let specificTherapistSelected =
        $("#Dropdown").find('input[name="radio-group"]:checked').val() ==
        "Specific Therapist"
          ? $(".PreferenceStaffSelect option:selected").text()
          : "";
      if (specificTherapistSelected.trim() != "") {
        arrayNotes.push(
          "Requested Therapist: " +
            specificTherapistSelected +
            "\nI am requesting this specific therapist. Please do not change my appointment."
        );
        docNotes =
          docNotes +
          "\nRequested Therapist: " +
          specificTherapistSelected +
          "\nI am requesting this specific therapist. Please do not change my appointment.";
      }

      let noteAppointment = $("#booknow").find(".notes").val();
      noteAppointment = noteAppointment.replace(/['"]/g, "");
      if (noteAppointment != "") {
        arrayNotes.push("Notes - " + noteAppointment);
        docNotes = docNotes + "\n" + noteAppointment;
      }

      activityLogs({
        from: "Continuous",
        siteid: $(".locations").find("input:checked").val(),
        locationId: $(".locations").find("input:checked").attr("data-id"),
        sessionTypeId: $(".sessions").find("input:checked").val(),
        tier: tierSelection,
        selectedTime: $("#userSelectedTime").text(),
        startDateTime: $("#userSelectedTime").attr("from"),
        endDateTime: $("#userSelectedTime").attr("to"),
        staffIds: $("#userSelectedTime").attr("staffIds"),
        notes: docNotes,
      });

      $("#bookNowInjury").modal("show");
      // if user is already login then booking directly. If not then naviagte to regiter form and book from now.
    }
  });

  $(document).on(
    "click",
    "#ContinuousInjury, #VerifiedContinue",
    async function () {
      $("#veriffProcess").modal("hide");
      $("#veriff-root").html("");
      if (!$("#bookNowInjury").find(".injuryNotice:checked").length) {
        $("#bookNowInjury")
          .find(".injuryNoticeErrorMsg")
          .fadeIn(300)
          .delay(5000)
          .fadeOut(300);
        return;
      } else {
        let verified = true;
        if ($(".places").find("input:checked").val() == 2) {
          verified = await checkClientVerification();
        }
        if (verified) {
          $("#bookNowInjury").modal("hide");
          $(".loader").show();
          sessionStorage.setItem("isOldRequested", false);
          if (JSON.parse(sessionStorage.getItem("isOldBook"))) {
            if ($("input[name='isRequested']").is(":checked")) {
              sessionStorage.setItem("isOldRequested", true);
            }
          }
          if (
            $("#clientDetailType").attr("clientType") == "new-account" &&
            !$(".profile").is(":visible")
          ) {
            // new account screen show
            $("#booknow").modal("hide");
            $(".sessionContent").hide();
            $(".availabilityContent").hide();
            $(".createAccountContent")
              .find("input[name='Email']")
              .val($("#clientDetailType").attr("clientEmail"));
            $(".createAccountContent")
              .find("input[name='FirstName']")
              .val($("#clientDetailType").attr("clientFirst"));
            $(".createAccountContent")
              .find("input[name='LastName']")
              .val($("#clientDetailType").attr("clientLast"));
            $(".createAccountContent")
              .find("input[name='MobilePhone']")
              .val($("#clientDetailType").attr("clientMobile"));
            $(".createAccountContent").show();
            $(".loader").hide();
            $(".bookNowContent").hide();
            $("#bookNowInjury")
              .find(".injuryNotice:checked")
              .prop("checked", false);
          } else {
            accounts();
            // addAppointment();
          }
        }
      }
    }
  );

  function checkClientVerification() {
    return new Promise((resolve, reject) => {
      $.ajax({
        url: url + "/endPoints.php",
        type: "post",
        data: { function: "clientVerification" },
        success: function (response) {
          response = JSON.parse(response);
          let isShow = true;
          let message = null;
          let color = "black";
          if (response.status && response.clientId) {
            resolve(true);
          } else if (!response.clientId) {
            $("#veriffProcess").modal("show");
            isShow = false;
            message = "Please login first to continue.";
            color = "red";
            startVerificationProcess(response, isShow, message, color);
            resolve(false);
          } else {
            $("#veriffProcess").modal("show");
            if (response.verified == 3) {
              isShow = false;
              color = "green";
              message =
                "Submitted verification is in process, please wait for approval.";
            }
            startVerificationProcess(response, isShow, message, color);
            resolve(false);
          }
        },
        error: function (xhr, status, error) {
          reject(error);
        },
      });
    });
  }

  $("#saveCC").click(function () {
    const siteId = $(".locations").find("input:checked").val();
    const form = $("#ccModal").find(".ccForm").serializeArray();

    // console.log("form", form, typeof form);
    let formStatus = false;
    form.map((item, index) => {
      if (!item.value) {
        formStatus = true;
      }
    });
    if (formStatus) {
      $(".ccError")
        .text("Please fill all required fields.")
        .fadeIn(300)
        .delay(5000)
        .fadeOut(300);
    } else {
      $(".loader").show();
      // $(".availabilityContent").hide();
      form.push({ name: "siteId", value: siteId });
      form.push({ name: "function", value: "updateCC" });

      $.ajax({
        url: url + "/endPoints.php",
        method: "post",
        data: form,
        success: function (data) {
          data = JSON.parse(data);
          if (data.Code == "CreditCardUpdated") {
            //accounts();
            addAppointment(data.MbId, data.Email);
          } else if (data.Error) {
            $(".loader").hide();
            $(".ccError")
              .text(data.Error.Message)
              .fadeIn(300)
              .delay(5000)
              .fadeOut(300);
            // $(".ccError").text(data.Error.Code).fadeIn(300).delay(5000).fadeOut(300);
          }
        },
      });
    }
    // console.log("siteid formData", form);
  });

  $("body").on("click", "input[name='timings']", function (e) {
    // $(".loader").show();
    // console.log("timing selected");
    availabilities(
      $(".locations").find("input:checked").val(),
      $(".locations").find("input:checked").attr("data-id"),
      $(".sessions").find("input:checked").val(),
      $(".selectedDay").attr("date"),
      $(".selectedDay").attr("date")
    );

    logs({
      from: "TimeChage",
      siteid: $(".locations").find("input:checked").val(),
      LocationIds: $(".locations").find("input:checked").attr("data-id"),
      SessionTypeIds: $(".sessions").find("input:checked").val(),
      PressureTypeIds: $(".pressures")
        .find("input[name='pressure10']:checked")
        .val(),
      specialPregAccomId: $("body")
        .find("input[name='pregnant']:checked")
        .val(),
      specialMinorAccomId: $("body").find("input[name='minor']:checked").val(),
      gender: $("input[name='Preference']:checked").val(),
      StartDate: $(".selectedDay").attr("date"),
      EndDate: $(".selectedDay").attr("date"),
      StaffId:
        $("#Dropdown").find('input[name="radio-group"]:checked').val() ==
        "Specific Therapist"
          ? $("#dropdownStaffList").val()
          : null,
      TimeToFilter: $("body").find('input[name="timings"]:checked').val(),
    });
  });

  $("body").on("click", ".nextbtnPlace", function (e) {
    window.scrollTo(0, 0);
    e.preventDefault();
    // $("#le_section-eight").hide();

    if ($(".places").find("input:checked").length) {
      $(".loader").show();
      $(".sessions").find("input:checked").prop("checked", false);
      // let placeID = $(".places").find("input:checked").val();
      // cities(placeID);
      $(".placeContent").hide();
      setSessionInDropdown($(".places").find("input:checked").val());
      $(".signupForm")
        .find("select[name='PreferredPlace']")
        .find(
          "option[data-sId!=" + $(".places").find("input:checked").val() + "]"
        )
        .hide();
      $(".signupForm")
        .find("select[name='PreferredPlace']")
        .find(
          "option[data-sId=" + $(".places").find("input:checked").val() + "]"
        )
        .show();
      if ($(".places").find("input:checked").val() == 1) {
        $(".locations").empty();
        locations(
          $(".cities").find("input:checked").val(),
          $(".places").find("input:checked").val()
        );
      } else if ($(".places").find("input:checked").val() == 2) {
        // $(".loader").show();
        $(".cityContent").hide();
        $(".sessionContent").show();
        $(".headerText").hide();
        $("#selectLengthHeader").hide();
        $("#sessionScreen").hide();
        $("#homeSessionScreen").hide();
        $("#selectCustomizationHeader").show();
        $(".customizeContent").show();
        $(".sessionContent")
          .find(".selections_list")
          .find(".locationSelected")
          .find("span")
          .html("In-Home Session");
        $(".sessionContent")
          .find("input[data-text='25 Min Massage']")
          .parent()
          .parent()
          .hide();
        $(".loader").hide();
      }

      // var val = $(".places").find("input:checked").val();
      // if (val == 1) {
      //   $(".allBtnCity").show();
      // } else {
      //   $(".allBtnCity").hide();
      // }
    } else {
      $(".placeErrorMsg")
        .text("first select your location !")
        .fadeIn(300)
        .delay(5000)
        .fadeOut(300);
    }
  });

  function setSessionInDropdown(placeId, selectedSession = "") {
    $(".lengthOfSession option").each(function () {
      if (placeId == 1 && $(this).attr("type") == "home") {
        $(this).hide();
        if ($(this).is(":selected")) {
          $(".lengthOfSession").val(""); // Deselect if hidden option is selected
        }
      } else if (placeId == 2 && $(this).attr("type") == "office") {
        $(this).hide();
        if ($(this).is(":selected")) {
          $(".lengthOfSession").val(""); // Deselect if hidden option is selected
        }
      } else if (
        $(".experiences").find("input:checked").val() == "Intern Therapists" &&
        $(this).attr("type") == "office"
      ) {
        $(this).hide();
        if ($(this).is(":selected")) {
          $(".lengthOfSession").val(""); // Deselect if hidden option is selected
        }
      } else if (
        $(".experiences").find("input:checked").val() ==
          "Specialist Therapists" &&
        $(this).attr("type") == "experience"
      ) {
        $(this).hide();
        if ($(this).is(":selected")) {
          $(".lengthOfSession").val(""); // Deselect if hidden option is selected
        }
      } else {
        $(this).show();
      }
    });

    if (selectedSession != "") {
      $(".lengthOfSession").val(selectedSession);
    }
  }

  $("body").on("click", ".prevbtnPlace", function (e) {
    window.scrollTo(0, 0);
    e.preventDefault();
    $(".placeContent").hide();
    $(".cityContent").show();
  });

  $("body").on("click", ".nextbtnCity", function (e) {
    window.scrollTo(0, 0);
    e.preventDefault();
    // $("#le_section-eight").hide();
    // $(".locations").empty();
    if ($(".cities").find("input:checked").length) {
      // if (
      //   $(".cities").find("input:checked").val() == "151471" &&
      //   $(".places").find("input:checked").val() == 2
      // ) {
      //   saveEmailToGoogleSheet();
      //   return false;
      // }
      // let placeID = $(".places").find("input:checked").val();
      // if (placeID == 1) {
      $(".loader").show();
      $(".places").find("input[value='1']").prop("checked", true);
      locations($(".cities").find("input:checked").val(), 1);
      // places();
      $(".sessionContent")
        .find("input[data-text='25 Min Massage']")
        .parent()
        .parent()
        .show();
      // } else {
      // if (
      //   $("input[name='gateCodes']").val().trim() == "" ||
      //   $("input[name='gateCodes']").val() === null
      // ) {
      //   $(".cityErrorMsg")
      //     .text("first enter your Gate Codes !")
      //     .fadeIn(300)
      //     .delay(5000)
      //     .fadeOut(300);
      //   return false;
      // }
      // $(".loader").show();
      // $(".cityContent").hide();
      // $(".sessionContent").show();
      // $(".headerText").hide();
      // $("#selectLengthHeader").hide();
      // $("#sessionScreen").hide();
      // $("#homeSessionScreen").hide();
      // $("#selectCustomizationHeader").show();
      // $(".customizeContent").show();
      // $(".sessionContent")
      //   .find(".selections_list")
      //   .find(".locationSelected")
      //   .find("span")
      //   .html("In-Home Session");
      // $(".sessionContent")
      //   .find("input[data-text='25 Min Massage']")
      //   .parent()
      //   .parent()
      //   .hide();
      // $(".loader").hide();
      // }

      // $(".signupForm")
      //   .find("select[name='PreferredCity']")
      //   .find(
      //     "option[data-sId!=" + $(".cities").find("input:checked").val() + "]"
      //   )
      //   .hide();
      // $(".signupForm")
      //   .find("select[name='PreferredCity']")
      //   .find(
      //     "option[data-sId=" + $(".cities").find("input:checked").val() + "]"
      //   )
      //   .show();

      // var val = $(".cities").find("input:checked").val();
    } else {
      $(".cityErrorMsg")
        .text("first select your City !")
        .fadeIn(300)
        .delay(5000)
        .fadeOut(300);
    }
  });

  $("body").on("click", ".nextbtnLocation", function (e) {
    window.scrollTo(0, 0);
    e.preventDefault();
    if ($(".locations").find("input:checked").length) {
      $("#le_section-eight").hide();
      $(".loader").show();
      $(".locationContent").hide();
      $(".sessionContent").show();
      $(".headerText").hide();
      $("#sessionScreen").hide();
      $("#homeSessionScreen").hide();
      $("#selectLengthHeader").hide();
      $("#selectCustomizationHeader").show();
      $(".customizeContent").show();
      $(".sessionContent")
        .find(".selections_list")
        .find(".locationSelected")
        .find("span")
        .html(
          $(".locations")
            .find("input:checked")
            .closest(".customlocation")
            .find(".locationaddress")
            .text()
        );
      $(".signupForm")
        .find("select[name='PreferredLocation']")
        .find(
          "option[data-sId!=" +
            $(".locations").find("input:checked").val() +
            "]"
        )
        .hide();
      $(".signupForm")
        .find("select[name='PreferredLocation']")
        .find(
          "option[data-sId=" + $(".locations").find("input:checked").val() + "]"
        )
        .show();

      var val = $(".locations").find("input:checked").val();
      var dataId = $(".locations").find("input:checked").attr("data-id");
      var city = $(".cities").find("input:checked").val();
      if (city == 151471 && dataId==1) {
        $(".sauna-sessions").hide();
      } else {
        if(city==151469){
          $("input[name='saunaSession']").val(410);
        }else{
          $("input[name='saunaSession']").val(354);
        }
        $(".sauna-sessions").show();
      }
      if (val == 0) {
        $("#websiteURL").attr(
          "href",
          "https://oakhavenmassage.com/san-antonio-memberships"
        );
        $("#msgTextMembership").text(
          "Our Membership Program allows you to save $20 Monday - Thursday and $10 Friday - Sunday. As a special online only offer, you can save 50% off your first month! Use promo code NEWMEM24 to get half off."
        );
      } else {
        $("#websiteURL").attr(
          "href",
          "https://oakhavenmassage.com/austin-membership"
        );
        $("#msgTextMembership").text(
          "Our Membership Program allows you to save $20 Monday - Thursday and $10 Friday - Sunday. As a special online only offer, you can save 50% off your first month! Use promo code NEWMEM24 to get half off."
        );
      }
      $(".locationsModal")
        .find(`input[value='${val}'][data-id='${dataId}']`)
        .prop("checked", true);
      logs({
        from: "Location",
        LocationId: $(".locations").find("input:checked").attr("data-id"),
      });
      $(".loader").hide();
    } else {
      $(".locationErrorMsg")
        .text("first select you Location !")
        .fadeIn(300)
        .delay(5000)
        .fadeOut(300);
    }
  });

  $("body").on("click", ".nextbtnSession", function (e) {
    window.scrollTo(0, 0);
    e.preventDefault();
    let $this = $(this);
    let placeID = $this.data("place");
    let siteID = $("input[name='City']:checked").val();
    if ($(".sessions").find("input:checked").length) {
      $(".loader").show();
      if (placeID == 1) {
        $(".sessionContent")
          .find(".selections_list")
          .find(".sessionSelected")
          .find("span")
          .text($("#sessionScreen").find("input:checked").data("text"));
      } else {
        $(".sessionContent")
          .find(".selections_list")
          .find(".sessionSelected")
          .find("span")
          .text($("#homeSessionScreen").find("input:checked").data("text"));
      }
      $(".sessionContent")
        .find(".selections_list")
        .find(".sessionSelected")
        .show();
      $(".headerText").hide();
      $("#sessionScreen").hide();
      $("#homeSessionScreen").hide();
      $(".loader").hide();
      getStaff(0);
      if (
        $(".sessions").find("input:checked").data("text").trim() ==
        "Youth Sports Massage | 25 Minutes"
      ) {
        $(".preferenceContent").show();
        $(".pressureContent").hide();
        $("#selectPreferenceHeader").show();
        typeOfPressureDropdown();
      } else {
        typeOfPressure();
        $("#selectPressureHeader").show();
        logs({
          from: "Session",
          LocationId: $(".locations").find("input:checked").attr("data-id"),
          SessionId: $(".sessions").find("input:checked").val(),
        });
        $(".pressureContent").show();
        $(".Tmt_therapy").parent().hide();
        if (siteID == 151471) {
          $(".Tmt_therapy").parent().show();
        }
      }
      $(".pressures").find("input:checked").prop("checked", false);
      setSessionInDropdown(placeID, $(".sessions").find("input:checked").val());
    } else {
      $(".sessionErrorMsg")
        .text("first select Length of Session !")
        .fadeIn(300)
        .delay(5000)
        .fadeOut(300);
    }
  });

  $("body").on("click", ".nextbtnSaunaSession", function (e) {
    window.scrollTo(0, 0);
    e.preventDefault();
    let $this = $(this);
    let placeID = $this.data("place");
    let siteID = $("input[name='City']:checked").val();

    if ($(".saunas").find("input:checked").length) {
      $(".loader").show();
      $(".sessionContent")
        .find(".selections_list")
        .find(".sessionSelected")
        .find("span")
        .text($("#sessionSaunaScreen").find("input:checked").data("text"));
      $(".sessionContent")
        .find(".selections_list")
        .find(".sessionSelected")
        .show();
      $(".headerText").hide();
      $("#sessionSaunaScreen").hide();
      availabilities(
        $(".locations").find("input:checked").val(),
        $(".locations").find("input:checked").attr("data-id"),
        $(".saunas").find("input:checked").val(),
        $(".selectedDay").attr("date"),
        $(".selectedDay").attr("date")
      );
      $(".loader").hide();
    } else {
      $(".sessionErrorMsg")
        .text("First Select the Length of Sauna Session !")
        .fadeIn(300)
        .delay(5000)
        .fadeOut(300);
    }
  });

  $("body").on("click", ".prevbtnCity", function (e) {
    window.scrollTo(0, 0);
    e.preventDefault();
    $(".placeContent").show();
    $("#le_section-eight").show();
    $(".cityContent").hide();
    $(".cities").empty();
    $(".homeDetails").hide();
    $(".otherHomeDetails").hide();
    $(".allBtnCity").hide();
    document.getElementById("homeAddress").value = "";
  });

  $("body").on("click", ".prevbtnLocation", function (e) {
    window.scrollTo(0, 0);
    e.preventDefault();
    $(".cityContent").show();
    $("#le_section-eight").show();
    $(".locationContent").hide();
    $(".locations").empty();
  });

  $("body").on("click", ".prevbtnExperience", function (e) {
    window.scrollTo(0, 0);
    e.preventDefault();
    $(".headerText").hide();
    $("#selectExperienceHeader").hide();
    $(".experienceContent").hide();
    $("#selectCustomizationHeader").show();
    $(".customizeContent").show();
  });

  $("body").on("click", ".prevbtnSession,.prevbtnSaunaSession", function (e) {
    window.scrollTo(0, 0);
    e.preventDefault();
    $("#sessionScreen").hide();
    $("#sessionSaunaScreen").hide();
    $("#homeSessionScreen").hide();
    $(".saunaLi").hide();
    $(".experienceLi").hide();
    $(".headerText").hide();
    if (
      $(".customizations").find("input:checked").val() == "Cutomize My Session"
    ) {
      if($(".cities").find('input:checked').val()==151471){
        $("#selectCustomizationHeader").show();
        $(".customizeContent").show();
      }else{
        $("#selectExperienceHeader").show();
        $(".experienceContent").show();
      }
    } else {
      $("#selectCustomizationHeader").show();
      $(".customizeContent").show();
    }
  });

  $("body").on("change", ".staffList", function (e) {
    e.preventDefault();
    $(".staffList").val($(this).val());
  });

  $("body").on("change", ".staffPreference", function (e) {
    e.preventDefault();
    if (e.target.value === "Specific Therapist") {
      $(".staffList").next().show();
      $(".tierListFilter").parent().hide();
      $(".tierListFilter").parent().prev().hide();
      $(".tierLi").hide();
    } else {
      if (sessionStorage.getItem("preference") == "Specific Therapist") {
        $(".tierListFilter").val(1).trigger("change");
      }
      $(".staffList").next().hide();
      if (
        $(".experiences").find("input:checked").val() == "Specialist Therapists"
      ) {
        $(".tierListFilter").parent().show();
        $(".tierListFilter").parent().prev().show();
        $(".tierLi").show();
      }
    }
    sessionStorage.setItem(
      "preference",
      $("#Dropdown").find('input[name="radio-group"]:checked').val()
    );
  });

  $(document).on(
    "change",
    ".filterOption .lengthOfSession,.filterOption .typeOfPressure,.filterOption .tierListFilter,.staffPreferenceFilter,.staffListFilter,#pregnantCheck,#minorCheck",
    function () {
      if ($(this).hasClass("lengthOfSession")) {
        if (
          $(".lengthOfSession").val() == "348" ||
          $(".lengthOfSession").val() == "412"
        ) {
          $(".pressure-li").hide();
          $(".pressure-li select").val("");
          $(".pressureLi").hide();
        } else {
          $(".pressure-li").show();
          if ($(".pressure-li select").val() != "") {
            $(".pressure-li select").val($(".pressure-li select").val());
          } else {
            $(".pressure-li select").val(
              $(".pressure-li").find('option[identity="Relaxation"]').val()
            );
          }
        }
        $(".pressure-li select").trigger("change");
      }
      if (
        $(".month").is(":visible") ||
        $(".preferenceTimeRow").is(":visible")
      ) {
        if ($(this).hasClass("tierListFilter")) {
          if (
            $(".filterOption input[name='radio-group']:checked").val() ==
            "Specific Therapist"
          ) {
            const tier = $(this).val();
            const staffList = $(".staffListFilter").val();
            getStaff(tier);
            $("#dropdownStaffList").removeClass("staffListFilter");
            setTimeout(() => {
              $("#dropdownStaffList").val(staffList);
              $("#dropdownStaffList").addClass("staffListFilter");
              $("#dropdownStaffList").trigger("change");
            }, 1000);
          } else {
            getStaff(0);
            $(".filterBtn").trigger("click");
          }
        } else {
          if (
            $(".filterOption input[name='radio-group']:checked").val() ==
            "Specific Therapist"
          ) {
            $(".filterBtn").trigger("click");
          } else {
            getStaff(0);
            $(".filterBtn").trigger("click");
          }
        }
      }
    }
  );

  $("body").on("click", ".nextbtnCustomization", function (e) {
    window.scrollTo(0, 0);
    e.preventDefault();
    if (!$(".customizations").find("input:checked").length) {
      $(".customizationErr").fadeIn(300).delay(5000).fadeOut(300);
      return false;
    }
    if (
      $(".customizations").find("input:checked").val().trim() ==
      "Re-Book My Last Session"
    ) {
      $.ajax({
        url: url + "/endPoints.php",
        method: "post",
        data: { function: "checklogin" },
        success: function (response) {
          response = JSON.parse(response);
          if (!response.Msg) {
            getClientVisits(response);
          } else {
            $(".customizeContent")
              .find(".loginErr")
              .fadeIn(300)
              .delay(5000)
              .fadeOut(300);
          }
        },
      });
    } else if (
      $(".customizations").find("input:checked").val().trim() == "Sauna Session"
    ) {
      $(".loader").show();
      $(".customizeContent").hide();
      $("#sessionScreen").hide();
      $("#sessionSaunaScreen").show();
      $(".sessionContent").show();
      $(".headerText").hide();
      $("#selectLengthSaunaHeader").show();
      $(".loader").hide();
      $(".sessionContent").find(".selections_list").find(".saunaLi").show();
    } else {
      $(".loader").show();
      $(".headerText").hide();
      $(".customizeContent").hide();
      $(".experiences").find('input:checked').prop('checked',false);
      if ($(".cities").find("input:checked").val() == 151471) {
        sessions(
          $(".locations").find("input:checked").data("place"),
          $(".locations").find("input:checked").val()
        );
        $("#selectLengthHeader").show();
        $(".tiers").find("input[value='0']").prop("checked", true);
        $(".experiences").find('input[value="Specialist Therapists"]').prop('checked',true);
        $(".experienceLi").hide();
      } else {
        $(".experienceContent").show();
        $("#selectExperienceHeader").show();
      }
      $(".loader").hide();
    }
  });

  $("body").on("click", ".nextbtnExperience", function (e) {
    window.scrollTo(0, 0);
    e.preventDefault();
    if (!$(".experiences").find("input:checked").length) {
      $(".experienceErr").fadeIn(300).delay(5000).fadeOut(300);
      return false;
    }

    $(".loader").show();
    $(".headerText").hide();

    sessions(
      $(".locations").find("input:checked").data("place"),
      $(".locations").find("input:checked").val()
    );
    $("#selectLengthHeader").show();
    $(".tiers").find("input[value='0']").prop("checked", true);
    $(".experienceContent").hide();
    $(".loader").hide();
  });

  function getClientVisits(user) {
    let siteId = $(".cities").find("input:checked").val();
    let placeID = $(".places").find("input:checked").val();
    let locationID = $(".locations").find("input:checked").data("id");
    $(".loader").show();
    $.ajax({
      url: url + "/endPoints.php",
      method: "post",
      data: {
        function: "getClientVisits",
        clientId: user.clientId,
        siteId: siteId,
        placeId: placeID,
        locationId: locationID,
      },
      success: function (response) {
        response = JSON.parse(response);
        if (!response.Error) {
          let lastVisit = response.Success.lastVisit;
          let staffList = response.Success.staffList;
          let pressureId = response.Success.pressureId
            ? response.Success.pressureId
            : false;
          $("#specificTherapistList").find(".staffList").html(staffList);
          $("#dropdownStaffList").html(staffList);
          getStaffBySiteLocation();
          $(`input[name='Location'][data-id='${lastVisit.locationId}']`).prop(
            "checked",
            true
          );
          $(`input[name='Session'][value='${lastVisit.sessionTypeId}']`).prop(
            "checked",
            true
          );
          if (pressureId) {
            $(`input[name='pressure10'][value='${pressureId}']`).prop(
              "checked",
              true
            );
          }
          $(".sessionSelected").show();
          setSessionInDropdown(
            placeID,
            $(".sessions").find("input:checked").val()
          );
          if (placeID == 1) {
            $(".sessionContent")
              .find(".selections_list")
              .find(".locationSelected")
              .find("span")
              .html(
                $(".locations")
                  .find("input:checked")
                  .closest(".customlocation")
                  .find(".locationaddress")
                  .text()
              );
            $(".sessionContent")
              .find(".selections_list")
              .find(".sessionSelected")
              .find("span")
              .text($(".lengthOfSession option:selected").text());
          }
          setTimeout(function () {
            $("#specificTherapistList").show();
            $("input[name='radio-group'][value='Specific Therapist']").prop(
              "checked",
              true
            );
            $("input[name='Preference'][value='Specific Therapist']").prop(
              "checked",
              true
            );
            $(".loader").hide();
            $(".customizeContent").hide();
            $(".nextbtnPreference").click();
          }, 500);
        } else {
          $(".loader").hide();
          $(".customizeContent")
            .find(".customErrorMsg")
            .text(response.Error.msg)
            .fadeIn(300)
            .delay(5000)
            .fadeOut(300);
        }
      },
    });
  }

  $("body").on("click", ".prevbtnCustomization", function (e) {
    window.scrollTo(0, 0);
    e.preventDefault();
    let placeID = $(".places").find("input:checked").val();
    placeID == 1 ? $(".locationContent").show() : $(".placeContent").show();
    $("#le_section-eight").show();
    $(".sessionContent").hide();
    $(".customizeContent").hide();
    $(".headerText").hide();
    $("#selectLocationHeader").show();
  });

  // male, female, specific
  $("body").on("click", ".nextbtnPreference", function (e) {
    e.preventDefault();
    sessionStorage.setItem("showTable", "#avilable_therapist");
    $("#dropdownMenu1").html(`<img src="images/setting.png"> Filter`);
    window.scrollTo(0, 0);
    if (!$(".preferences").find("input:checked").length) {
      $(".preferenceRequireeErr")
        .text("first select Preference !")
        .fadeIn(300)
        .delay(5000)
        .fadeOut(300);
    }

    if (
      $(".preferences").find("input:checked").length &&
      $(".preferences").find("input:checked").val() == "Specific Therapist" &&
      !$(".preferenceContent").find(".staffList").val()
    ) {
      $(".preferenceRequireeStaffErr")
        .text("first Choose Therapist !")
        .fadeIn(300)
        .delay(5000)
        .fadeOut(300);
    } else if ($(".preferences").find("input:checked").length) {
      $(".headerText").hide();
      $(".loader").show();
      let val = $(".preferenceContent")
        .find(".preferences")
        .find("input:checked")
        .val();
      $("#Dropdown")
        .find(`input[name='radio-group'][value='${val}']`)
        .prop("checked", true);
      $("#Dropdown")
        .find(`input[name='radio-group'][value='${val}']`)
        .trigger("change");
      if (
        $(".preferenceContent").find(".preferences").find("input:checked")
          .length
      ) {
        $(".sessionContent")
          .find(".selections_list")
          .find(".preferenceLi")
          .find("span")
          .text(
            $(".preferenceContent")
              .find(".preferences")
              .find("input:checked")
              .val() === "None"
              ? "No Preference"
              : $(".preferenceContent")
                  .find(".preferences")
                  .find("input:checked")
                  .val()
          );
        $(".sessionContent")
          .find(".selections_list")
          .find(".preferenceLi")
          .show();
      } else {
        $(".sessionContent")
          .find(".selections_list")
          .find(".preferenceLi")
          .hide();
      }

      if (
        $(".preferences").find("input:checked").val() == "Specific Therapist"
      ) {
        let selectedValuesName = $("select[name='PreferenecMultiStaff[]']")
          .map(function () {
            let vals = $(this).val();
            if (!vals) return []; // skip if nothing selected

            // always make it array
            vals = Array.isArray(vals) ? vals : [vals];

            return vals.map((val) => {
              return $(this).find(`option[value="${val}"]`).text().trim();
            });
          })
          .get();

        // Remove blanks
        let cleaned = selectedValuesName.filter((val) => val);

        // Identify Tier in each value (or null if none)
        let tiers = cleaned.map((val) => {
          if (val.includes("Tier 2")) return "Tier 2";
          if (val.includes("Tier 3")) return "Tier 3";
          if (val.includes("Tier 4")) return "Tier 4";
          return null; // means no tier present
        });

        let allEmpty = tiers.length === 0;
        let allSameTier = !tiers.includes(null) && new Set(tiers).size === 1;
        let allNoTier = tiers.every((t) => t === null);
        let commonTier = true;
        // console.log(selectedValues,cleaned,tiers,allEmpty,allSameTier,allNoTier);
        if (!allEmpty && !allSameTier && !allNoTier) {
          commonTier = false;
        }
        let selectedValues = $("select[name='PreferenecMultiStaff[]']")
          .val()
          .filter((val) => val);
        // console.log(selectedValues);return;
        let tier = commonTier ? getStaffTier(selectedValues[0]) : 0;
        $(`input[name='Tier'][value='${tier}']`).prop("checked", true);
        sessionStorage.setItem("tier", tier);
        $("#dropdownStaffList")
          .val($(".PreferenceStaffSelect").val())
          .trigger("change");
        $("select.staffList")
          .val($(".PreferenceStaffSelect").val())
          .trigger("change");
        // typeOfPressure();
        if (tier != 0 && selectedValues.length == 1) {
          updateStaffSelectedBioProfile();
          $(".preferenceTimeRow").show();
          $("#confirmPopUpStaffInfo").css("display", "block");
          sessionStorage.setItem("isTier", true);
        } else {
          sessionStorage.setItem("isTier", false);
          $(".preferenceTimeRow").hide();
        }
        availabilities(
          $(".locations").find("input:checked").val(),
          $(".locations").find("input:checked").attr("data-id"),
          $(".sessions").find("input:checked").val(),
          $(".selectedDay").attr("date"),
          $(".selectedDay").attr("date")
        );
        $(".headerText").hide();
        $("#selectAvailabilityHeader").show();
        getPrice(
          $(".locations").find("input:checked").val(),
          $(".sessions").find("input:checked").val(),
          $(".PreferenceStaffSelect option:selected").text()
        );
        $(".pressureLi").hide();
        $(".dropdown").removeClass("open");
      } else {
        sessionStorage.setItem(
          "preference",
          $(".preferences").find("input:checked").val()
        );
        $(".preferenceTimeRow").hide();
        if (
          $(".experiences").find("input:checked").val() == "Intern Therapists"
        ) {
          $(".tierListFilter").val(1);
          sessionStorage.setItem("tier", 1);
          sessionStorage.setItem("isTier", true);
          availabilities(
            $(".locations").find("input:checked").val(),
            $(".locations").find("input:checked").attr("data-id"),
            $(".sessions").find("input:checked").val(),
            $(".selectedDay").attr("date"),
            $(".selectedDay").attr("date")
          );
          $(".tierListFilter").parent().hide();
          $(".tierListFilter").parent().prev().hide();
          $(".tierLi").hide();
          $(".dropdown").removeClass("open");
          $("#dropdownMenu1").html(`<img src="images/setting.png"> Filter`);
        } else {
          $(".tierContent").show();
          $("#selectTierHeader").show();
          $("#dropdownStaffList").val("");
          $(`input[name='Tier'][value='0']`).prop("checked", false);
        }
      }
      $(".preferenceContent").hide();
      $(".pressureContent").hide();
      $(".loader").hide();
    }
  });

  $("body").on("click", ".prevbtnPreference", function (e) {
    e.preventDefault();
    window.scrollTo(0, 0);
    if (
      $(".sessions").find("input:checked").data("text") ==
      "Youth Sports Massage | 25 Minutes"
    ) {
      $(".pressureContent").hide();
      $(".preferenceLi, .pressureLi, .pregnantLi, .minorLi").hide();
      $(".headerText").hide();
      $(".sessionSelected").hide();
      if ($(".places").find("input:checked").val() == 1) {
        $("#sessionScreen").show();
        $("#homeSessionScreen").hide();
      } else {
        $("#homeSessionScreen").show();
        $("#sessionScreen").hide();
      }
      $("#selectLengthHeader").show();
    } else {
      $(".pressureContent").show();
      $("#selectPressureHeader").show();
      $(".pressureLi").hide();
    }
    $(".pressures").find("input:checked").prop("checked", false);
    $(".preferenceContent").hide();
    $(".headerText").hide();
  });

  $("body").on("click", ".nextbtnPressure", function (e) {
    // console.log("Yoo yoo");
    e.preventDefault();
    window.scrollTo(0, 0);
    if ($(".pressures").find("input[name='pressure10']:checked").length) {
      // Check if the "minor" or "pregnant" checkbox is checked
      let isMinorChecked = $("input.typeOfPressureInput[name='minor']").is(
        ":checked"
      );
      let isPregnantChecked = $(
        "input.typeOfPressureInput[name='pregnant']"
      ).is(":checked");
      // Check if either the "minor" or "pregnant" checkbox is checked
      if (isMinorChecked) {
        if ($(".typeOfPressureInput").next(".minorInput").val() == "") {
          $(".pressureErrorMsg")
            .text("first add Age of Minor !")
            .fadeIn(300)
            .delay(5000)
            .fadeOut(300);
          return;
        }
        $(".minorLi").show();
      }
      if (isPregnantChecked) {
        if ($(".typeOfPressureInput").next(".pregnantInput").val() == "") {
          $(".pressureErrorMsg")
            .text("first add Months of Pregnant !")
            .fadeIn(300)
            .delay(5000)
            .fadeOut(300);
          return;
        }
        $(".pregnantLi").show();
      }

      let pressure = $(".pressures")
        .find("input[name='pressure10']:checked")
        .closest("label")
        .find(".type_head")
        .text();
      let pressureId = $(".pressures")
        .find("input[name='pressure10']:checked")
        .val();
      $(".typeOfPressure").val(pressureId);
      $(".sessionContent")
        .find(".selections_list")
        .find(".pressureLi")
        .find("span")
        .text(pressure);
      $(".pressureLi").show();

      $(".pressureContent").hide();

      logs({
        from: "Pressure",
        LocationId: $(".locations").find("input:checked").attr("data-id"),
        SessionId: $(".sessions").find("input:checked").val(),
        TypeOfPressure: $(".pressures")
          .find("input[name='pressure10']:checked")
          .val(),
        PressureTypeIds: $(".pressures")
          .find("input[name='pressure10']:checked")
          .val(),
        specialPregAccomId: $("body")
          .find("input[name='pregnant']:checked")
          .val(),
        specialMinorAccomId: $("body")
          .find("input[name='minor']:checked")
          .val(),
        gender: $("input[name='Preference']:checked").val(),
      });

      getStaff();
      $(".preferenceContent").show();
      $(".headerText").hide();
      $("#selectPreferenceHeader").show();
      // tierprices();
      // availabilities($('.locations').find("input:checked").val(),$('.locations').find("input:checked").attr('data-id'),$('.sessions').find("input:checked").val(),$('.selectedDay').attr('date'),$('.selectedDay').attr('date'));
    } else {
      $(".pressureErrorMsg")
        .text("first select Type of Massage !")
        .fadeIn(300)
        .delay(5000)
        .fadeOut(300);
    }
  });

  $("body").on("click", ".prevbtnPressure", function (e) {
    e.preventDefault();
    window.scrollTo(0, 0);
    $(".pressureContent").hide();
    $(".preferenceLi, .pressureLi, .pregnantLi, .minorLi").hide();
    $(".headerText").hide();
    $(".sessionSelected").hide();
    if ($(".places").find("input:checked").val() == 1) {
      $("#sessionScreen").show();
      $("#homeSessionScreen").hide();
    } else {
      $("#homeSessionScreen").show();
      $("#sessionScreen").hide();
    }
    $("#selectLengthHeader").show();
  });

  $("body").on("click", ".nextbtnTier", function (e) {
    e.preventDefault();
    // console.log("Tier");
    window.scrollTo(0, 0);
    if (!$(".tiers").find("input:checked").length) {
      $(".tierSelectionErr").fadeIn(300).delay(5000).fadeOut(300);
      return false;
    }
    if ($(".tiers").find("input[name='Tier']:checked").length) {
      let tierSelected = $(".tiers").find("input[name='Tier']:checked").val();
      // console.log(tierSelected);
      if (tierSelected == 0) {
        // console.log("working if");
        $(".sessionContent")
          .find(".selections_list")
          .find(".tierLi")
          .find("span")
          .text("No Tier Preference");
      } else {
        // console.log("working else");
        $(".sessionContent")
          .find(".selections_list")
          .find(".tierLi")
          .find("span")
          .text("Tier " + tierSelected);
      }

      $(".tierLi").show();

      $(".tierListFilter").val(tierSelected);
      sessionStorage.setItem("tier", tierSelected);
      sessionStorage.setItem("isTier", true);

      if (
        $("#Dropdown").find('input[name="radio-group"]:checked').val() ==
        "Specific Therapist"
      ) {
        updateStaffSelectedBioProfile();
        $(".preferenceTimeRow").show();
        $("#confirmPopUpStaffInfo").css("display", "block");
      } else {
        $(".preferenceTimeRow").hide();
        $("#confirmPopUpStaffInfo").css("display", "none");
        // $("#dropdownStaffList").val("");
      }

      if (
        $(".sessions").find("input:checked").data("text") ==
        "Youth Sports Massage | 25 Minutes"
      ) {
        $(".pressure-li").hide();
        $(".pressure-li select").val("");
      } else {
        $(".pressure-li").show();
      }

      // we need to call api for get timings of avaiability staffs
      availabilities(
        $(".locations").find("input:checked").val(),
        $(".locations").find("input:checked").attr("data-id"),
        $(".sessions").find("input:checked").val(),
        $(".selectedDay").attr("date"),
        $(".selectedDay").attr("date")
      );
      $(".dropdown").removeClass("open");
      $("#dropdownMenu1").html(`<img src="images/setting.png"> Filter`);
      activityLogs({
        from: "Tier",
        LocationId: $(".locations").find("input:checked").attr("data-id"),
        SessionId: $(".sessions").find("input:checked").val(),
        TypeOfPressure: $(".pressures")
          .find("input[name='pressure10']:checked")
          .val(),
        PressureTypeIds: $(".pressures")
          .find("input[name='pressure10']:checked")
          .val(),
        specialPregAccomId: $("body")
          .find("input[name='pregnant']:checked")
          .val(),
        specialMinorAccomId: $("body")
          .find("input[name='minor']:checked")
          .val(),
        gender: $("input[name='Preference']:checked").val(),
        StaffId:
          $("#Dropdown").find('input[name="radio-group"]:checked').val() ==
          "Specific Therapist"
            ? $("#dropdownStaffList").val()
            : null,
        tier: tierSelected,
      });

      $(".tierContent").hide();
      $(".headerText").hide();
      $("#selectAvailabilityHeader").show();
    } else {
      $(".tierSelectionErr")
        .text("first select Type of Tier !")
        .fadeIn(300)
        .delay(5000)
        .fadeOut(300);
    }
  });

  $("body").on("click", ".prevbtnTier", function (e) {
    e.preventDefault();
    window.scrollTo(0, 0);
    let customizeVal = $(".customizations").find("input:checked").val();
    $(".tierContent").hide();
    $(".headerText").hide();
    $(".pregnantLi, .minorLi").hide();
    $(".preferenceContent").show();
    $("#selectPreferenceHeader").show();
    $(".preferenceLi").hide();
    $("#specificTherapistList").find(".PreferenceStaffSelect").show();
    $("#specificTherapistList").find("#preferenceMultiStaff").next().show();
  });

  $("body").on("click", ".prevbtnAvailability", function (e) {
    e.preventDefault();
    $(".filterOption").hide();
    // getStaff(0);
    window.scrollTo(0, 0);
    auto = false;
    let customizationOption = $(".customizeContent")
      .find("input:checked")
      .val();
    $(".availabilityContent").hide();
    $(".headerText").hide();
    $(".tierLi").hide();
    $("#specificTherapistList").find(".PreferenceStaffSelect").show();
    if (customizationOption == "Re-Book My Last Session") {
      $(".customizeContent").show();
      $("#selectCustomizationHeader").show();
      $(
        ".preferenceLi,.pressureLi,.pregnantLi,.sessionSelected,.tierLi"
      ).hide();
    } else if (customizationOption == "Sauna Session") {
      $(
        ".preferenceLi,.pressureLi,.pregnantLi,.sessionSelected,.tierLi"
      ).hide();
      $("#sessionSaunaScreen").show();
    } else {
      // const selectedTherapists=$(".staffListFilter").val();
      // getStaff(0);
      // setTimeout(()=>{
      //   $("#preferenceMultiStaff").val(selectedTherapists).trigger('change');
      // },1000)
      if (
        $("#Dropdown").find('input[name="radio-group"]:checked').val() ==
        "Specific Therapist"
      ) {
        $(".preferenceContent").show();
        $("#selectPreferenceHeader").show();
        $(".pressureLi").hide();
      } else {
        if (
          $(".experiences").find("input:checked").val() == "Intern Therapists"
        ) {
          $(".pregnantLi, .minorLi").hide();
          $(".preferenceContent").show();
          $("#selectPreferenceHeader").show();
          $(".preferenceLi").hide();
          $("#specificTherapistList").find(".PreferenceStaffSelect").show();
          $("#specificTherapistList")
            .find("#preferenceMultiStaff")
            .next()
            .show();
        } else {
          $(".tierContent").show();
          $("#selectTierHeader").show();
        }
      }
    }
    // } else {
    //   if (
    //     $("#Dropdown").find('input[name="radio-group"]:checked').val() ==
    //     "Specific Therapist"
    //   ) {
    //     $(".pressureContent").show();
    //     $("#selectPressureHeader").show();
    //   } else {
    //     $(".tierContent").show();
    //     $("#selectTierHeader").show();
    //   }
    // }
  });

  $("body").on("click", ".prevbtnBookNow", function (e) {
    e.preventDefault();
    window.scrollTo(0, 0);
    $(".bookNowContent").hide();
    $(".availabilityContent").show();
    $(".sessionContent").show();
  });

  $("body").on("click", ".prevbtnCreateAccount", function (e) {
    e.preventDefault();
    window.scrollTo(0, 0);
    $(".createAccountContent").hide();
    $(".bookNowContent").show();
  });

  $("body").on("click", ".prevbtnPayment", function (e) {
    e.preventDefault();
    window.scrollTo(0, 0);
    $(".createAccountContent").hide();
    $(".paymentPageContent").hide();
    $(".availabilityContent").show();
    $(".sessionContent").show();
  });

  $("body").on("click", ".createAccountBtn", function (e) {
    e.preventDefault();
    var errorMessages = "";
    var createCientStatus = true;

    if (
      $(".createAccountContent").find("input[name='term']").prop("checked") !=
      true
    ) {
      createCientStatus = false;
      errorMessages =
        errorMessages + "First check I agree with the above terms.<br>";
    }

    var fillStatus = false;
    $(".createAccountContent")
      .find(".signupForm")
      .find(`input:not([name="term"]),select`)
      .each(function () {
        if ($(this).val() == "") {
          fillStatus = true;
        }
      });
    if (fillStatus) {
      errorMessages = errorMessages + "Please fill all required fields.<br>";
      createCientStatus = false;
    }

    var cardInfo = {
      // Address: $(".cardInfo").find("input[name='address']").val(),
      CardHolder: $(".cardInfo").find("input[name='accountHolderName']").val(),
      CardNumber: $(".cardInfo").find("input[name='ccNumber']").val(),
      // City: $(".cardInfo").find("input[name='city']").val(),
      ExpMonth: $("#cardExpMonth").val(),
      ExpYear: $("#cardExpYear").val(),
      PostalCode: $(".cardInfo").find("input[name='postalCode']").val(),
      // State: $("#StateForCard").val()
    };

    $(".createAccountContent")
      .find("input[name='Password'],input[name='ConfirmPassword']")
      .prop("min", 8);
    const email = $(".createAccountContent").find("input[name='Email']").val();
    const pass = $(".createAccountContent")
      .find("input[name='Password']")
      .val();
    const conPass = $(".createAccountContent")
      .find("input[name='ConfirmPassword']")
      .val();

    if (!validateEmail(email)) {
      errorMessages = errorMessages + "Please enter Valid Email.<br>";
      createCientStatus = false;
    }
    if (pass != conPass) {
      errorMessages =
        errorMessages + "Password and Confirm Password does not match.";
      createCientStatus = false;
    }

    var cardValidation = false;
    // if (cardInfo.Address != "" && cardInfo.CardHolder != "" && cardInfo.CardNumber != "" && cardInfo.City != "" && cardInfo.ExpMonth != "" && cardInfo.ExpYear != "" && cardInfo.PostalCode != "" && cardInfo.State != "" && cardInfo.ExpYear != null && cardInfo.ExpMonth != null) {
    if (
      cardInfo.CardHolder != "" &&
      cardInfo.CardNumber != "" &&
      cardInfo.ExpMonth != "" &&
      cardInfo.ExpYear != "" &&
      cardInfo.PostalCode != "" &&
      cardInfo.ExpYear != null &&
      cardInfo.ExpMonth != null
    ) {
      cardValidation = true;
    }
    if (cardValidation == false) {
      // $(".cardAccErrorMessage").html('Please fill out all required fields');
      if (createCientStatus) {
        errorMessages = errorMessages + "Please fill all required fields.<br>";
        createCientStatus = false;
      }
    }

    // $(".createAccountContent").hide();
    // $(".headerText").hide();
    // $(".paymentPageContent").show();
    // // console.log();
    // return false;

    if (createCientStatus) {
      $.ajax({
        url: url + "/endPoints.php",
        method: "post",
        data: {
          function: "addClient",
          siteid: $(".locations").find("input:checked").val(),
          Email: $(".createAccountContent").find("input[name='Email']").val(),
          Password: $(".createAccountContent")
            .find("input[name='Password']")
            .val(),
          MobilePhone: $(".createAccountContent")
            .find("input[name='MobilePhone']")
            .val(),
          FirstName: $(".createAccountContent")
            .find("input[name='FirstName']")
            .val(),
          LastName: $(".createAccountContent")
            .find("input[name='LastName']")
            .val(),
          ReferredBy: "Another client",
          Test: false,
          ClientCreditCard: cardInfo,
        },
        success: function (data) {
          var clientData = JSON.parse(data);
          if (clientData.Error) {
            // InvalidClientCreation
            if (clientData.Error.Code == "InvalidPaymentInfo") {
              errorMessages =
                errorMessages + clientData.Error.Message + ".<br>";
              $(".createAccErrorMessage").html(errorMessages);
            } else if (clientData.Error.Code == "InvalidClientCreation") {
              errorMessages =
                errorMessages + clientData.Error.Message + ".<br>";
              $(".createAccErrorMessage").html(errorMessages);
            } else {
              $(".createAccErrorMessage").html("Something went wrong.");
            }
            window.scrollTo(0, 0);
          } else {
            // cEmail = clientData.Client['Email'];
            $(".profile").attr("data-id", clientData.Client["Email"]);
            $(".profile").find("a:first").text(clientData.Client["FirstName"]);
            $(".profile").show();
            $(".loader").show();
            // console.log("client-create-account-done", "add-apointment-start");
            if ($(".places").find("input:checked").val() == 1) {
              addAppointment(
                clientData.Client["Id"],
                clientData.Client["Email"]
              );
            } else {
              $(".createAccountContent").hide();
              $(".headerText").hide();
              $(".paymentPageContent").show();
              $(".payBookAppointmentBtn").attr(
                "data-cid",
                clientData.Client["Id"]
              );
              $(".payBookAppointmentBtn").attr(
                "data-cname",
                clientData.Client["FirstName"]
              );
              $(".payBookAppointmentBtn").attr(
                "data-cmail",
                clientData.Client["Email"]
              );
              $(".loader").hide();
              checkClientCreditCard(
                $(".cities").find("input:checked").val(),
                clientData.Client["Id"]
              );
            }
          }
        },
      });
    } else {
      $(".createAccErrorMessage").html(errorMessages);
      window.scrollTo(0, 0);
    }
  });

  $("body").on("click", ".backToHome", function (e) {
    e.preventDefault();
    location.reload();
  });

  $("body").on("click", ".choosOtherTharapist", function (e) {
    e.preventDefault();
    $(".allreadyBooked").hide();
    $(".bookingSuspendedError").hide();
    $(".sessionContent").show();
    $("#mainscreen").show();
    $(".availabilityContent").show();
    $(".createAccountContent").hide();
    $(".paymentPageContent").hide();
    $(".nextbtnTier").trigger("click");
  });

  $("body").on("click", ".changeLocation", function (e) {
    e.preventDefault();
    var val = $("#changelocation")
      .find(".locationsModal")
      .find("input:checked")
      .val();
    var dataId = $("#changelocation")
      .find(".locationsModal")
      .find("input:checked")
      .attr("data-id");
    $(".locations")
      .find(`input[value='${val}'][data-id='${dataId}']`)
      .prop("checked", true);

    $(".selections_list")
      .find("li:first")
      .find("span")
      .text(
        $(".locations")
          .find("input:checked")
          .closest(".customlocation")
          .find(".locationaddress")
          .text()
      );

    $(".signupForm")
      .find("select[name='PreferredLocation']")
      .find(
        "option[data-sId!=" + $(".locations").find("input:checked").val() + "]"
      )
      .hide();
    $(".signupForm")
      .find("select[name='PreferredLocation']")
      .find(
        "option[data-sId=" + $(".locations").find("input:checked").val() + "]"
      )
      .show();

    $("#changelocation").modal("hide");
    // $(".loader").show();
    availabilities(
      $(".locations").find("input:checked").val(),
      $(".locations").find("input:checked").attr("data-id"),
      $(".sessions").find("input:checked").val(),
      $(".selectedDay").attr("date"),
      $(".selectedDay").attr("date")
    );

    logs({
      from: "ChangeLocation",
      siteid: $(".locations").find("input:checked").val(),
      LocationIds: $(".locations").find("input:checked").attr("data-id"),
      SessionTypeIds: $(".sessions").find("input:checked").val(),
      PressureTypeIds: $(".pressures")
        .find("input[name='pressure10']:checked")
        .val(),
      specialPregAccomId: $("body")
        .find("input[name='pregnant']:checked")
        .val(),
      specialMinorAccomId: $("body").find("input[name='minor']:checked").val(),
      gender: $("input[name='Preference']:checked").val(),
      StartDate: $(".selectedDay").attr("date"),
      EndDate: $(".selectedDay").attr("date"),
      StaffId:
        $("#Dropdown").find('input[name="radio-group"]:checked').val() ==
        "Specific Therapist"
          ? $(".availabilityContent").find(".staffList").val()
          : null,
      TimeToFilter: $("body").find('input[name="timings"]:checked').val(),
    });
  });

  $("body").on("click", ".noStaffChangelocation", function (e) {
    e.preventDefault();
    $("#changelocation").modal("show");
  });

  $("body").on("click", ".addFamilyMemberBtn", function (e) {
    $(this).closest(".row").hide();
    $(".addFamilyMemberSection").show();
  });

  $("body").on("click", ".cancelFamilySaveBtn", function (e) {
    $(".addFamilyMemberSection").hide();
    $(".addFamilyMemberSection")
      .find("input[type='text'],input[type='email']")
      .val("");
    $(".addFamilyMemberSection")
      .find("input[type='radio']")
      .prop("checked", false);
    $(".addFamilyMemberSection").hide();
    $(".addFailyErrorMessage").html("");
    $(".addFamilyMemberBtn").closest(".row").show();
  });

  $("body").on("click", ".addFamilySaveBtn", function (e) {
    var firstName = $(".familySection").find("input[name='FirstName']").val();
    var lastName = $(".familySection").find("input[name='LastName']").val();
    var relationship = $(".familySection")
      .find("select[name='Relationship']")
      .val();
    var relationshipName = $(".familySection")
      .find("select[name='Relationship'] option:selected")
      .text();

    var mobile = $(".familySection").find("input[name='Mobile']").val();
    var gender = $(".familySection").find("select[name='Gender']").val();
    var genderName = $(".familySection")
      .find("select[name='Gender'] option:selected")
      .text();

    var email = $(".familySection").find("input[name='Email']").val();
    var paidclient = $(".familySection")
      .find("input[name='paidclient']:checked")
      .val();
    var birthDate = $(".familySection").find("input[name='BirthDate']").val();

    if (firstName == "" || lastName == "" || email == "" || !paidclient) {
      $(".addFailyErrorMessage").html("Please fill all required fields.");
    } else if (
      email == $(".createAccountContent").find("input[name='Email']").val()
    ) {
      $(".addFailyErrorMessage").html("Email should be unique.");
    } else {
      $.ajax({
        url: url + "/endPoints.php",
        method: "post",
        data: {
          function: "clients",
          siteid: $(".locations").find("input:checked").val(),
          SearchText: email,
        },
        success: function (data) {
          var clients = JSON.parse(data);
          if (clients.length == 0) {
            $(".addedFamilyMembers")
              .append(`<div class="row mt-10 familymember" paid="${paidclient}">
                        <div class="col-md-3"><strong>First name</strong>: <span>${firstName}</span></div>
                        <div class="col-md-3"><strong>Last name</strong>: <span>${lastName}</span></div>
                        <div class="col-md-3" val="${relationship}"><strong>Relationship</strong>: <span>${relationshipName}</span></div>
                        <div class="col-md-3"><strong>Mobile phone</strong>: <span>${mobile}</span></div>
                        <button type="button" class="removeFamilyMember" style="position: absolute;"> × </button>
                        <div class="col-md-3" val="${gender}"><strong>Gender</strong>: <span>${genderName}</span></div>
                        <div class="col-md-3"><strong>Email</strong>: <span>${email}</span></div>
                        <div class="col-md-3"><strong>Paid for by New Client?</strong>: <span>${paidclient}</span></div>
                        <div class="col-md-3"><strong>Birthday</strong>: <span>${birthDate}</span></div>
                        </div>`);
            $(".addFamilyMemberSection")
              .find("input[type='text'],input[type='email']")
              .val("");
            $(".addFamilyMemberSection")
              .find("input[type='radio']")
              .prop("checked", false);
            $(".addFamilyMemberSection").hide();
            $(".addFailyErrorMessage").html("");
            $(".addFamilyMemberBtn").closest(".row").show();
          } else {
            $(".addFailyErrorMessage").html("This email is already in use.");
          }
        },
      });
    }
  });

  $("body").on("click", ".login", function (e) {
    $("#loginModal").modal("show");
  });

  $(".pregnentCheckbox").click(function () {
    $(".pregnantInput").toggle();
    $(".pregnantmsg").toggle();
  });

  $(".minorCheckbox").click(function () {
    $(".minorInput").toggle();
    $(".minormsg").toggle();
  });

  $("input[name='pregnantMinor']").on("click", function () {
    $(this).closest("div").find("input[type='number']").val("");
    if ($(this).prop("checked") == true) {
      // $("input[name='pregnantMinor']").prop("checked",false);
      $(this).prop("checked", true);

      // $(this).closest(".filterOption").find("input[type='number']").hide();
      $(this).closest("div").find("input[type='number']").show();
    } else {
      // $("input[name='pregnantMinor']").prop("checked",false);
      $(this).closest("div").find("input[type='number']").hide();
    }
  });

  $("body").on("click", ".removeFamilyMember", function (e) {
    $(this).closest(".familymember").remove();
  });

  $("body").on("click", "input[name='pressure10']", function (e) {
    if ($(this).prop("checked") == true) {
      $(".pressures").find("input[name='pressure10']").prop("checked", false);
      $(this).prop("checked", true);
    } else {
      $(".typeOfPressure").val("");
    }
  });

  $(document).on("click", "#dropdownMenu1", function (e) {
    e.preventDefault(); // Prevent default toggle
    let $dropdown = $(this).closest(".dropdown");
    let $button = $(this);
    let preference = sessionStorage.getItem("preference");
    let tier = sessionStorage.getItem("tier");

    if ($dropdown.hasClass("open")) {
      $dropdown.removeClass("open"); // Close manually
      $button.html(`<img src="images/setting.png"> Filter`);
      if (
        $(".staffPreference:checked").val() === "Specific Therapist" &&
        $(".staffListFilter").val() === ""
      ) {
        $(`.staffPreferenceFilter[value='${preference}']`).prop(
          "checked",
          true
        );
        $(`.tierListFilter`).val(tier).trigger("change");
      }
    } else {
      $(".dropdown").removeClass("open"); // close any other open dropdowns if needed
      $dropdown.addClass("open"); // Open manually
      $button.html(`<img src="images/cancel3.png"> Close`);
    }
  });

  // $(document).on("click", function (e) {
  //   if (!$(e.target).closest(".dropdown").length) {
  //     $(".dropdown").removeClass("open");
  //     $("#dropdownMenu1").html(`<img src="images/setting.png"> Filter`);
  //   }
  // });

  $(".filterBtn").on("click", function () {
    // alert('yes');
    if ($(".lengthOfSession").val() == "") {
      $("#Dropdown")
        .find(".preferenceRequireeStaffErr")
        .text("first Choose session !")
        .fadeIn(300)
        .delay(5000)
        .fadeOut(300);
    } else {
      let sessionChangeValue = $(".lengthOfSession").val();
      $(
        'input[type="radio"][name="Session"][value="' +
          sessionChangeValue +
          '"]'
      ).prop("checked", true);
      $(".sessionContent")
        .find(".selections_list")
        .find(".sessionSelected")
        .find("span")
        .text($(".lengthOfSession option:selected").text());
      let val = $("#Dropdown").find("input[name='radio-group']:checked").val();
      $(".preferenceContent")
        .find(".preferences")
        .find(`input[value='${val}']`)
        .prop("checked", true);
      $(".preferenceContent")
        .find(".preferences")
        .find(`input[value='${val}']`)
        .trigger("change");

      if (
        $(".preferenceContent").find(".preferences").find("input:checked")
          .length
      ) {
        // console.log("prefe>>1st if");
        $(".sessionContent")
          .find(".selections_list")
          .find(".preferenceLi")
          .find("img")
          .attr(
            "src",
            $("#Dropdown")
              .find("input[name='radio-group']:checked")
              .attr("picture")
              .replace("white", "green")
          );
        $(".sessionContent")
          .find(".selections_list")
          .find(".preferenceLi")
          .find("span")
          .text(
            $("#Dropdown").find("input[name='radio-group']:checked").val() ===
              "None"
              ? "No Preference"
              : $(".preferenceContent")
                  .find(".preferences")
                  .find("input:checked")
                  .val()
          );
        $(".sessionContent")
          .find(".selections_list")
          .find(".preferenceLi")
          .show();
      } else {
        // console.log("prefe>>>else")
        $(".sessionContent")
          .find(".selections_list")
          .find(".preferenceLi")
          .hide();
      }

      // tier selected
      let tierSelected = $(".tierListFilter").val();
      sessionStorage.setItem("tier", tierSelected);
      $("body")
        .find("input[name='Tier']")
        .each(function () {
          if ($(this).val() === tierSelected) {
            $(this).prop("checked", true);
            if (tierSelected == 0) {
              $(".tierLi span").text("No Tier Preference");
              sessionStorage.setItem("isTier", false);
            } else {
              sessionStorage.setItem("isTier", true);
              $(".tierLi span").text("Tier " + tierSelected);
            }
          }
        });
      // console.log('after');
      filterElements();
      setShowFilterSec();
      // $(".dropdown").removeClass("open");
      availabilities(
        $(".locations").find("input:checked").val(),
        $(".locations").find("input:checked").attr("data-id"),
        $(".sessions").find("input:checked").val(),
        $(".selectedDay").attr("date"),
        $(".selectedDay").attr("date")
      );

      activityLogs({
        from: "ChageFilter",
        tier: tierSelected,
        siteid: $(".locations").find("input:checked").val(),
        LocationIds: $(".locations").find("input:checked").attr("data-id"),
        SessionTypeIds: $(".sessions").find("input:checked").val(),
        PressureTypeIds: $(".pressures")
          .find("input[name='pressure10']:checked")
          .val(),
        specialPregAccomId: $("body")
          .find("input[name='pregnant']:checked")
          .val(),
        specialMinorAccomId: $("body")
          .find("input[name='minor']:checked")
          .val(),
        gender: $("input[name='Preference']:checked").val(),
        StartDate: $(".selectedDay").attr("date"),
        EndDate: $(".selectedDay").attr("date"),
        StaffId:
          $("#Dropdown").find('input[name="radio-group"]:checked').val() ==
          "Specific Therapist"
            ? $(".availabilityContent").find(".staffList").val()
            : null,
        TimeToFilter: $("body").find('input[name="timings"]:checked').val(),
      });
    }
  });

  $("input[name='minor'], input[name='pregnant']").click(function () {
    const name = $(this).attr("name");
    const val = $(this).closest("div").find("input[type='number']").val();
    const checked = $(this).prop("checked");
    const inputs = $(`input[name='${name}']`);
    for (var i = 0; i < inputs.length; i++) {
      $(inputs[i]).closest("div").find("input[type='number']").val(val);
      if (checked) {
        $(inputs[i]).closest("div").find("input[type='number'],p").show();
        $(inputs[i]).prop("checked", true);
      } else {
        $(inputs[i]).closest("div").find("input[type='number'],p").hide();
        $(inputs[i]).prop("checked", false);
      }
    }
  });

  $("body").on("change", ".pregnantInput, .minorInput", function () {
    const name = $(this).hasClass("minorInput");
    const val = $(this).val();
    $("body")
      .find("." + (name ? "minorInput" : "pregnantInput"))
      .each(function () {
        $(this).val(val);
      });
  });

  $("body").on("click", ".viewStaffProfile", function () {
    $.ajax({
      url: url + "/endPoints.php",
      method: "post",
      data: {
        function: "getStaffBio",
        siteid: $(".locations").find("input:checked").val(),
        staffId: $(this).attr("data-id"),
      },
      success: function (data) {
        if (data != null) {
          let dataStaff = JSON.parse(data);
          $("#staffHTMLDetails").empty();
          $("#staffHTMLDetails").append(dataStaff.Bio);
          $("#viewStaffProfile").modal("show");
          $("#viewStaffProfile").css("display", "block");
        }
      },
    });
  });
});

function updateStaffSelectedBioProfile() {
  // console.log("USpapa");
  let selectedOption = $(".PreferenceStaffSelect option:selected");
  let therapistId = selectedOption.val();
  let bio = selectedOption.attr("bio");
  let imageurl = selectedOption.attr("imageurl");
  let therapistName = selectedOption.text();

  $("#confirmPopUpStaffName").text(therapistName);
  $("#therapistNameTitle").text(therapistName);

  $(".viewStaffProfile").attr("data-id", therapistId);
  // Update therapist image
  if (imageurl != "") {
    $(".preferenceTimeRow .therapist_pic img").attr("src", imageurl);
    $("#staffProfileImage").attr("src", imageurl);
    $("#confirmPopUpStaffImage").attr("src", imageurl);
    $("#therapistImgView").attr("src", imageurl);
  } else {
    $(".preferenceTimeRow .therapist_pic img").attr(
      "src",
      "images/defaultImg2.jpg"
    );
    $("#staffProfileImage").attr("src", "images/defaultImg2.jpg");
    $("#confirmPopUpStaffImage").attr("src", "images/defaultImg2.jpg");
  }

  // Update therapist name
  if (therapistName != "") {
    $(".preferenceTimeRow .therapist_name h1").text(therapistName);
  } else {
    $(".preferenceTimeRow .therapist_name h1").text("Therapist Name");
  }

  // Update button data-target attribute
  if (bio == "yes") {
    $(".preferenceTimeRow .therapist_name button").attr(
      "data-target",
      "#viewprofile" + therapistId
    );
    $(".preferenceTimeRow .therapist_name button").css("display", "block");
  } else {
    $(".preferenceTimeRow .therapist_name button").css("display", "none");
    $("#staffHTMLDetails").append("");
  }
}

$(document).on("click", ".close", function () {
  $(this).closest(".modal").modal("hide");
});

$(document).on("click", "#ViewTierPrices", function () {
  let $this = $(this);
  let placeID = $(".places").find("input:checked").val();
  let cityID = $(".cities").find("input:checked").val();
  let sessionID = $(".sessions").find("input:checked").val();
  let pressureID = $(".pressures")
    .find("input[name='pressure10']:checked")
    .val();
  if (cityID == "151469") {
    $("#TierPriceModal")
      .find("#tierPricesImage")
      .attr("src", "images/san-antonio-prices.jpg");
  } else {
    $("#TierPriceModal")
      .find("#tierPricesImage")
      .attr("src", "images/austin-prices.png");
  }
  $("#TierPriceModal").modal("toggle");
});

function tierprices() {
  let placeID = $(".places").find("input:checked").val();
  let cityID = $(".cities").find("input:checked").val();
  let sessionID = $(".sessions").find("input:checked").val();
  let pressureID = $(".pressures")
    .find("input[name='pressure10']:checked")
    .val();
  $.ajax({
    url: url + "/endPoints.php",
    method: "post",
    data: {
      function: "tierprices",
      place: placeID,
      city: cityID,
      session: sessionID,
      pressure: pressureID,
    },
    success: function (data) {
      if (isJson(data)) {
        let tiers = JSON.parse(data);
        // Loop through the object
        let modalContent = $("#modalData");

        // Clear existing content
        modalContent.empty();

        // $.each(tiers, function (key, values) {
        //   let fieldset = $("<fieldset>").css({
        //     display: "flex",
        //     justifyContent: "space-around",
        //     marginBottom: "20px",
        //   });

        //   let legend = $("<legend>").text(key.toUpperCase());
        //   fieldset.append(legend);

        //   $.each(values, function (subKey, value) {
        //     let div = $("<div>").html(
        //       `<span>TIER ${subKey}</span> - $${value}`
        //     );
        //     fieldset.append(div);
        //   });

        //   modalContent.append(fieldset);
        // });
        $.each(tiers, function (key, values) {
          let fieldset = $("<fieldset>").css({
            display: "flex",
            justifyContent: "space-around",
            marginBottom: "20px",
          });

          let legend = $("<legend>").text(key.toUpperCase());
          fieldset.append(legend);

          // Get the Tier 1 price
          let tier1Price = parseInt(values["1"]);

          // Loop through the tiers
          $.each(values, function (subKey, value) {
            let displayPrice;

            if (subKey === "1") {
              // Tier 1 price is the original price
              displayPrice = tier1Price;
            } else {
              // For other tiers, calculate the difference with Tier 1
              displayPrice = parseInt(value) - tier1Price;
            }

            // If it's Tier 1, show the price as-is; otherwise, show it as "+$difference"
            let displayText =
              subKey === "1" ? `: $${displayPrice}` : `+$${displayPrice}`;

            let div = $("<div>").html(
              `<span>TIER ${subKey}</span> ${displayText}`
            );
            fieldset.append(div);
          });

          modalContent.append(fieldset);
        });
      }
    },
  });
}

// $(document).on("click", "input[name='City']:checked", function () {
//   let $this = $(this);
//   let places = $(".places").find("input:checked").val();
//   if (places == 2) {
//     if ($this.val() == "151469") {
//       $(".homeDetails").show();
//     } else {
//       saveEmailToGoogleSheet();
//       $(this).prop("checked", false);
//       $(".homeDetails").hide();
//     }
//   }
// });

function saveEmailToGoogleSheet() {
  Swal.fire({
    title: "COMING SOON TO AUSTIN",
    icon: "info",
    input: "email",
    inputAttributes: {
      placeholder: "Email ID",
    },
    text: "Provide your email id and we will notify you when in-home service becomes available here.",
    showCancelButton: true,
    confirmButtonText: "Continue",
    confirmButtonColor: "var(--bg-color)",
    showLoaderOnConfirm: true,
    preConfirm: async (email) => {
      try {
        const ajaxurl =
          mainUrl + `/checkout_backend/saveEmailToSheet.php?email=${email}`;
        const response = await fetch(ajaxurl);
        if (response.success === false) {
          return Swal.showValidationMessage(
            `${JSON.stringify(await response.json())}`
          );
        }
        return response.json();
      } catch (error) {
        Swal.showValidationMessage(`Request failed: ${error}`);
      }
    },
    allowOutsideClick: () => !Swal.isLoading(),
  }).then((result) => {
    if (result.isConfirmed) {
      Swal.fire("Saved!", "", "success");
    }
  });
}

$("input[name=pay]").click(function () {
  if (this.id == "watch-me") {
    $("#show-me").show("slow");
    $("#savedCardMain").hide("slow");
  } else {
    $("#show-me").hide("slow");
    $("#savedCardMain").show("slow");
  }
  $(".payBookAppointmentBtn").parent().parent().show();
});

function checkCheckoutCardDetails() {
  let isValid = true;
  if (!$("#selectCardMethod").is(":hidden")) {
    const selectedRadio = $('input[name="pay"]:checked');
    if (!selectedRadio.length) {
      toastr.error("Please select payment type");
      isValid = false;
    }
  }
  if (!$("#show-me").is(":hidden")) {
    var cardNumberNew = $("#cardNumber").val();
    var cardNameNew = $("#cardName").val();
    var cardMonthNew = $("#cardMonth").val();
    var cardYearNew = $("#cardYear").val();
    var cardCvvNew = $("#cardCvv").val();
    var currentYear = new Date().getFullYear();
    var currentMonth = new Date().getMonth() + 1; // Note: JavaScript months are zero-based

    if (
      cardNumberNew === "" ||
      cardNameNew === "" ||
      cardYearNew === "" ||
      cardMonthNew === "" ||
      cardCvvNew === ""
    ) {
      Swal.fire("Error!", "Please fill all required fields", "error");
      isValid = false;
    } else if (cardNumberNew.length !== 16) {
      Swal.fire("Error!", "Card number must be 16 digits long", "error");
      isValid = false;
    } else if (
      cardYearNew < currentYear ||
      (cardYearNew == currentYear && cardMonthNew < currentMonth)
    ) {
      Swal.fire(
        "Error!",
        "The provided credit card expiration date is invalid",
        "error"
      );
      isValid = false;
    } else if (/^\d{3,4}$/.test(cardCvvNew) != true) {
      Swal.fire("Error!", "The provided credit card CVV is invalid", "error");
      isValid = false;
    }
  }
  return isValid;
}

$(document).on("click", ".payBookAppointmentBtn", function () {
  let $this = $(this);
  if (checkCheckoutCardDetails()) {
    const placeID = $(".places").find("input:checked").val();
    const cityID = $(".cities").find("input:checked").val();
    const siteid = $(".locations").find("input:checked").val();
    const locationId = $(".locations").find("input:checked").attr("data-id");
    const sessionTypeId = $(".sessions").find("input:checked").val();
    const tier = $(".tiers").find("input:checked").val();
    var startDateTime = $("#userSelectedTime").attr("from");
    var endDateTime = $("#userSelectedTime").attr("to");
    var staffIdsTobeBooked = $("#userSelectedTime").attr("staffids");
    let clientId = $this.data("cid");
    let clientName = $this.data("cname");
    let clientEmail = $this.data("cmail");
    let payType = $("input[name='pay']:checked").val();
    let gender = $(
      ".cust_filter_gender input[name='radio-group']:checked"
    ).val();

    let docNotes = "";
    let arrayNotes = [];

    var staffIdsArray = staffIdsTobeBooked.split(",");
    var staffNames = staffIdsArray.map((id) => {
      return $(".staffListFilter").find(`option[value='${id}']`).text();
    });
    staffNames.sort();
    const firstStaffName = staffNames[0];
    let firstStaffTier = 1;
    if (firstStaffName.includes("Tier 2")) {
      firstStaffTier = 2;
    } else if (firstStaffName.includes("Tier 3")) {
      firstStaffTier = 3;
    } else if (firstStaffName.includes("Tier 4")) {
      firstStaffTier = 4;
    }

    let staffRequested = gender == "Specific Therapist" ? true : false;
    let specificTherapistSelected =
      $("#Dropdown").find('input[name="radio-group"]:checked').val() ==
      "Specific Therapist"
        ? $(".PreferenceStaffSelect option:selected").text()
        : "";
    if (JSON.parse(sessionStorage.getItem("isOldRequested"))) {
      staffRequested = true;
      specificTherapistSelected = $("#therapistNameTitle").text();
    }

    if (placeID == 2) {
      arrayNotes.push("Location: In-Home Session");
      docNotes = docNotes + "\nLocation: In-Home Session";
      arrayNotes.push("Home Address: " + $("input[name='homeAddress']").val());
      docNotes =
        docNotes + "\nHome Address: " + $("input[name='homeAddress']").val();
      arrayNotes.push("Gate Codes: " + $("input[name='gateCodes']").val());
      docNotes =
        docNotes + "\nGate Codes: " + $("input[name='gateCodes']").val();
      arrayNotes.push("Pet Info: " + $("input[name='petInfo']").val());
      docNotes = docNotes + "\nPet Info: " + $("input[name='petInfo']").val();
      arrayNotes.push(
        "Entry Instructions: " + $("input[name='entryInstruction']").val()
      );
      docNotes =
        docNotes +
        "\nEntry Instructions: " +
        $("input[name='entryInstruction']").val();
    } else {
      arrayNotes.push("Location: In-Office Session");
      docNotes = docNotes + "\nLocation: In-Office Session";
    }

    if ($("#promocode").val() !== "") {
      arrayNotes.push("Promo Code - " + $("#promocode").val());
      docNotes = "Promo Code - " + $("#promocode").val();
    }

    let areaFocusSelected = $("#booknow")
      .find("input[name='area-focus']:checked")
      .val();
    if (areaFocusSelected == "Specific Areas") {
      let specificAreas = [];
      // Iterate through all specific areas checkboxes
      $('input[name="specific-areas"]:checked').each(function () {
        specificAreas.push($(this).val());
      });
      // Join the specific areas array values with comma separator
      let specificAreasString = specificAreas.join(", ");
      if (specificAreasString !== "") {
        arrayNotes.push("Focus : Specific Areas - " + specificAreasString);
        docNotes =
          docNotes + "\nFocus : Specific Areas - " + specificAreasString;
      }
    } else if (areaFocusSelected == "Other") {
      let otherString = $("#otherArea").val();
      arrayNotes.push("Focus Area: " + otherString);
      docNotes = docNotes + "\nFocus Area: " + otherString;
    } else {
      arrayNotes.push("Focus - Full Body");
      docNotes = docNotes + "\nFocus - Full Body";
    }

    let pregnantlength = $(".filterOption").find(
      "input[name='pregnant']:checked"
    ).length;
    let pregnantName = $(".filterOption")
      .find("input[name='pregnant']:checked")
      .hasClass("pregnant")
      ? "Pregnant"
      : "Minor";
    let pregnantAge = $(".filterOption")
      .find("input[name='pregnant']:checked")
      .closest("div")
      .find("input[type='number']")
      .val();

    if (pregnantlength && pregnantAge != "") {
      let monthYear =
        pregnantAge != 1
          ? (pregnantName == "Pregnant" ? "month" : "year") + "s"
          : pregnantName == "Pregnant"
          ? "month"
          : "year";
      arrayNotes.push(pregnantName + " - " + pregnantAge + " " + monthYear);
      docNotes =
        docNotes + "\n" + pregnantName + " - " + pregnantAge + " " + monthYear;
    } else if (pregnantlength) {
      arrayNotes.push(pregnantName + " - ");
      docNotes = docNotes + "\n" + pregnantName + " - ";
    }

    let minorlength = $(".filterOption").find(
      "input[name='minor']:checked"
    ).length;
    let minorName = $(".filterOption")
      .find("input[name='minor']:checked")
      .hasClass("pregnant")
      ? "Pregnant"
      : "Minor";
    let minorAge = $(".filterOption")
      .find("input[name='minor']:checked")
      .closest("div")
      .find("input[type='number']")
      .val();

    if (minorlength && minorAge != "") {
      let monthYear =
        minorAge != 1
          ? (minorName == "Pregnant" ? "month" : "year") + "s"
          : minorName == "Pregnant"
          ? "month"
          : "year";
      arrayNotes.push(minorName + " - " + minorAge + " " + monthYear);
      docNotes =
        docNotes + "\n" + minorName + " - " + minorAge + " " + monthYear;
    } else if (minorlength) {
      arrayNotes.push(minorName + " - ");
      docNotes = docNotes + "\n" + minorName + " - ";
    }

    if ($(".typeOfPressure").val() != "") {
      arrayNotes.push(
        "Massage - " + $(".typeOfPressure option:selected").text()
      );
      docNotes =
        docNotes + "\nMassage - " + $(".typeOfPressure option:selected").text();
    }

    if ($("input[name='Preference']").is(":checked")) {
      if (
        $("input[name='Preference']:checked").val().trim() !=
        "Specific Therapist"
      ) {
        arrayNotes.push(
          "Gender Preference: " + $("input[name='Preference']:checked").val()
        );
        docNotes =
          docNotes +
          "\nGender Preference: " +
          $("input[name='Preference']:checked").val();
      }
    }

    if ($("#booknow").find("input[name='oil-radio']").is(":checked")) {
      arrayNotes.push(
        "Essential Oil: " +
          $("#booknow").find("input[name='oil-radio']:checked").val()
      );
      docNotes =
        docNotes +
        "\nEssential Oil: " +
        $("#booknow").find("input[name='oil-radio']:checked").val();
    }

    arrayNotes.push("Tier selected: " + "Tier " + firstStaffTier);
    docNotes = docNotes + "\nTier selected: " + "Tier " + firstStaffTier;

    if (specificTherapistSelected.trim() != "") {
      arrayNotes.push(
        "Requested Therapist: " +
          firstStaffName +
          "\nI am requesting this specific therapist. Please do not change my appointment."
      );
      docNotes =
        docNotes +
        "\nRequested Therapist: " +
        firstStaffName +
        "\nI am requesting this specific therapist. Please do not change my appointment.";
    }

    let noteAppointment = $("#booknow").find(".notes").val();
    noteAppointment = noteAppointment.replace(/['"]/g, "");
    if (noteAppointment != "") {
      arrayNotes.push("Notes - " + noteAppointment);
      docNotes = docNotes + "\n" + noteAppointment;
    }

    if (payType == "save") {
      var cardInfos = {
        type: "saved",
        cardProvider: $("#savedCardInner").find(".provider").data("value"),
        cardNumber: $("#savedCardInner").find(".number").data("value"),
        cardHolder: $("#savedCardInner").find(".holder").data("value"),
        cardMonth: $("#savedCardInner")
          .find(".good-through-value")
          .data("month"),
        cardYear: $("#savedCardInner").find(".good-through-value").data("year"),
      };
    } else {
      cardInfos = {
        type: "new",
        cardNumber: $("#newCreditCardDetails").find("#cardNumber").val(),
        cardHolder: $("#newCreditCardDetails").find("#cardName").val(),
        cardMonth: $("#newCreditCardDetails").find("#cardMonth").val(),
        cardYear: $("#newCreditCardDetails").find("#cardYear").val(),
        cardCvv: $("#newCreditCardDetails").find("#cardCvv").val(),
      };
    }

    // console.log(docNotes);return false;
    let postData = {
      function: "payAndBookAppointment",
      tier: firstStaffTier,
      placeid: placeID,
      cityid: cityID,
      siteid: siteid,
      locationId: locationId,
      sessionTypeId: sessionTypeId,
      staffId: staffIdsTobeBooked,
      startDateTime: startDateTime,
      endDateTime: endDateTime,
      notes: docNotes,
      arrayNotes: arrayNotes,
      id: clientId,
      Email: clientEmail,
      gender: gender == "Specific Therapist" ? "None" : gender,
      cardInfo: cardInfos,
    };

    let cueerntTT = new Date();
    cueerntTT = moment(cueerntTT).format("X");

    let aptTime = new Date(startDateTime);
    aptTime = moment(aptTime).format("X");
    // console.log(postData, cueerntTT, aptTime);
    // console.log("add-apointment-end", "check-appointmentIsPassed");
    $.ajax({
      url: url + "/endPoints.php",
      method: "post",
      data: {
        function: "appointmentIsPassed",
        srtartDateTime: startDateTime,
      },
      success: function (res) {
        var resData = JSON.parse(res);
        if (resData.data) {
          $(".createAccountContent").hide();
          $("#loginbox").modal("hide");
          $("#booknow").modal("hide");
          $(".availabilityContent").hide();
          $(".bookNowContent").hide();
          $(".loader").hide();
          $(".middlesection").hide();
          $(".allreadyBooked").show();
          $("#alreadyBookMsg").text("Time selected is already passed.");
        } else {
          $.ajax({
            url: url + "/endPoints.php",
            method: "post",
            data: postData,
            beforeSend: function () {
              $(".loader").show();
            },
            success: function (data) {
              // console.log("appointment-booking-end");
              var appointmentData = JSON.parse(data);
              // console.log(appointmentData);
              $("#SuppressAccount").modal("hide");
              $("#reportconfirmpopup").modal("hide");
              if (
                appointmentData.Error &&
                appointmentData.Error.Code == "ValidationFailed"
              ) {
                // Oops
                $(".allreadyBooked").show();
                $(".createAccountContent").hide();
                $(".availabilityContent").hide();
                $(".bookNowContent").hide();
                $("#booknow").modal("hide");
                $("#ccModal").modal("hide");
                $(".availabilityContent").closest(".middlesection").hide();
                $(".loader").hide();
                $(".sessionContent").hide();
                $("#allreadyBooked").text(
                  "Oh bummer, another client snagged this spot before we could confirm for you."
                );
                getloginName();
              } else if (
                appointmentData.Error &&
                appointmentData.Error.Code == "BookingSuspended"
              ) {
                $(".locationName").text("Team");
                $(".bookingSuspendedError").show();
                $("#booknow").modal("hide");
                $("#ccModal").modal("hide");
                $(".createAccountContent").hide();
                $(".availabilityContent").hide();
                $(".availabilityContent").closest(".middlesection").hide();
                $(".sessionContent").hide();
                $(".loader").hide();
              } else if (
                appointmentData.Error &&
                appointmentData.Error.Code == "CreditCardRequired"
              ) {
                $(".createAccountContent").hide();
                $("#booknow").modal("hide");
                $(".loader").hide();
                $(".sessionContent").hide();
                Swal.fire("Error!", appointmentData.Error.msg, "error");
                // $("#ccModal").modal("show");
              } else if (!!appointmentData.Appointments[0].Id) {
                //booked ok
                $(".createAccountContent").hide();
                $(".availabilityContent").hide();
                $(".bookNowContent").hide();
                $(".paymentPageContent").hide();
                $("#booknow").modal("hide");
                $("#ccModal").modal("hide");
                // $(".addAppBy").text(appointmentData.FirstName);
                $(".sessionContent").hide();
                getloginName();
                $(".appointmentBookedOn").text(
                  moment($("#userSelectedTime").attr("from")).format(
                    "Do MMMM YYYY, h:mm a"
                  )
                );
                $(".thankYouContext").show();

                $(".loader").hide();
                window.scrollTo(0, 0);

                sendAptConfirmMail(
                  // $("#booknow").find(".therapist_name").text(),
                  moment($("#userSelectedTime").attr("from")).format(
                    "Do MMMM YYYY, h:mm a"
                  ),
                  arrayNotes,
                  appointmentData.Appointments[0].ClientId,
                  siteid,
                  appointmentData.Appointments[0].Id,
                  ""
                );
                if (
                  sessionStorage.getItem("oakHavenData") &&
                  window.location.href.includes("?no")
                ) {
                  cancleAppointment(
                    sessionStorage.getItem("oakHavenData").split("_")[4],
                    sessionStorage.getItem("oakHavenData").split("_")[0]
                  );
                }
                sessionStorage.removeItem("oakHavenData");
              } else {
                $(".somethingWrong").show();
                $(".createAccountContent").hide();
                $(".availabilityContent").hide();
                $(".bookNowContent").hide();
                $("#booknow").modal("hide");
                $("#ccModal").modal("hide");
                $(".availabilityContent").closest(".middlesection").hide();
                $(".loader").hide();
                $(".sessionContent").hide();
                $("#alreadyBookMsg").text(
                  "Oh bummer, another client snagged this spot before we could confirm for you."
                );
                getloginName();
              }
            },
          });
        }
      },
    });
  }
});

function checkClientCreditCard(siteID, clientID) {
  $("#clientWalletBal").html("");
  $("#clientWalletBal").attr("data-walletbalance", 0);
  $(".loader").show();
  $.ajax({
    url: url + "/endPoints.php",
    method: "post",
    data: {
      function: "getClientCardInfo",
      siteId: siteID,
      clientId: clientID,
    },
    success: function (response) {
      response = JSON.parse(response);
      $("#clientWalletBal").html("$ " + response.accountBalance);
      $("#clientWalletBal").attr("data-walletbalance", response.accountBalance);
      if (response.status == "SUCCESS") {
        let creditHtml = `<div class="credit-card">
          <div class="provider" data-value="${response.creditcardinfo.CardType}">${response.creditcardinfo.CardType}</div>
          <div class="number mt-10 text-center" data-value="${response.creditcardinfo.LastFour}">**** **** **** ${response.creditcardinfo.LastFour}</div>
          <div class="good-through-label">good<br/>through</div>
          <div class="good-through-value" data-month="${response.creditcardinfo.ExpMonth}" data-year="${response.creditcardinfo.ExpYear}">${response.creditcardinfo.ExpMonth}/${response.creditcardinfo.ExpYear}</div>
          <div class="holder" data-value="${response.creditcardinfo.CardHolder}">${response.creditcardinfo.CardHolder}</div>
        </div>`;
        $("#savedCardMain").find("#savedCardInner").html(creditHtml);
        $("#selectCardMethod").find(".main-div-savedc").show();
        $("input[name='pay'][value='save']").trigger("click");
      } else {
        $("input[name='pay'][value='new']").trigger("click");
      }
      $(".loader").hide();
    },
  });
}

// $(document).on("change", "#dropdownStaffList", function () {
//   let $this = $(this);
//   let value = $this.val();
//   let name = $this.find(`option[value='${value}']`).text();
//   let tier = 1;
//   if (name.includes("Tier 2")) {
//     tier = 2;
//   } else if (name.includes("Tier 3")) {
//     tier = 3;
//   } else if (name.includes("Tier 4")) {
//     tier = 4;
//   }
//   tier = JSON.parse(sessionStorage.getItem('isTier'))? tier : 0;
//   if($("#SpecificTherapist").is(":checked")){
//     $(".tierListFilter").val(tier);
//   }
// });

function getStaffTier(value) {
  let name = $("#dropdownStaffList").find(`option[value='${value}']`).text();
  let tier = 1;
  if (name.includes("Tier 2")) {
    tier = 2;
  } else if (name.includes("Tier 3")) {
    tier = 3;
  } else if (name.includes("Tier 4")) {
    tier = 4;
  }
  return tier;
}

$(document).on("click", ".dont-see-time", function () {
  $("#requestAppointment").modal("show");
});

function generateTimeSlots(interval) {
  $("#timePreferred").empty(); // Clear previous options

  var startTime = 9 * 60; // 9:00 AM in minutes
  var endTime = 21 * 60; // 9:00 PM in minutes

  for (var i = startTime; i < endTime; i += interval) {
    var startHours = Math.floor(i / 60);
    var startMinutes = i % 60;
    var startAmPm = startHours >= 12 ? "PM" : "AM";
    startHours = startHours > 12 ? startHours - 12 : startHours;
    startMinutes = startMinutes < 10 ? "0" + startMinutes : startMinutes;

    var endTimeSlot = i + interval;
    var endHours = Math.floor(endTimeSlot / 60);
    var endMinutes = endTimeSlot % 60;
    var endAmPm = endHours >= 12 ? "PM" : "AM";
    endHours = endHours > 12 ? endHours - 12 : endHours;
    endMinutes = endMinutes < 10 ? "0" + endMinutes : endMinutes;

    var timeSlot = `${startHours}:${startMinutes} ${startAmPm} - ${endHours}:${endMinutes} ${endAmPm}`;
    $("#timePreferred").append(
      `<option value="${timeSlot}">${timeSlot}</option>`
    );
  }
}

$(document).on("change", "#sessionTime", function () {
  var sessionVal = $(this).val();
  let newInterval = parseInt(
    $(`#sessionTime option[value='${sessionVal}']`).attr("gap")
  );
  generateTimeSlots(newInterval);
});

$(document).on("submit", "#requestAppointmentForm", function (e) {
  e.preventDefault();
  var $this = $(this);
  let city = $(".locations")
    .find("input:checked")
    .closest(".customlocation")
    .find(".locationaddress b")
    .attr("city");
  let location = $(".locations")
    .find("input:checked")
    .closest(".customlocation")
    .find(".locationaddress b")
    .text();
  let therapistId = $("#availableStaffList").val();
  let thrapistName = $(
    `#availableStaffList option[value='${therapistId}']`
  ).text();
  var formData = new FormData(this);
  var $submitBtn = $this.find('button[type="submit"]');
  formData.append("location", location + ", " + city);
  formData.append("therapistPreferred", thrapistName);
  $submitBtn
    .prop("disabled", true)
    .html('<i class="fa fa-spinner fa-spin"></i> Submitting...');
  $.ajax({
    url: url + "/requestAppointment.php",
    method: "post",
    data: formData,
    processData: false, // ✅ Prevent jQuery from converting data to a string
    contentType: false, // ✅ Ensure proper FormData headers
    success: function (response) {
      Swal.fire({
        title: "Done",
        text: "Your request for appointment submitted successfully.",
        icon: "success",
      });
      $("#requestAppointmentForm").trigger("reset");
      $("#timePreferred").empty();
      $("#timePreferred").append(
        "<option value='' hidden>Choose session first</option>"
      );
      $submitBtn.prop("disabled", false).html("Submit");
    },
    error: function (xhr, status, error) {
      console.error("AJAX Error:", error);
    },
  });
});

$(document).ready(function () {
  $("input[name='datePreferred']").datepicker({
    dateFormat: "mm-dd-yy",
  });
  $("#datePreferredIcon").click(function () {
    $("input[name='datePreferred']").trigger("focus");
  });
});

$(document).on(
  "click",
  "#showAvailableTimes,#showAvailableTherapist",
  function () {
    let $this = $(this);
    if ($this.attr("id") == "showAvailableTimes") {
      $("#avilable_therapist_all_wrapper").hide();
      $("#avilable_therapist_all").hide();
      $("#avilable_therapist").show();
      sessionStorage.setItem("showTable", "#avilable_therapist");
    } else {
      $("#avilable_therapist").hide();
      $("#avilable_therapist_all_wrapper").show();
      $("#avilable_therapist_all").show();
      sessionStorage.setItem("showTable", "#avilable_therapist_all_wrapper");
    }
  }
);

$(document).on("change", "input[name='Place']", function () {
  let $this = $(this);
  if ($this.val() == 1) {
    $(".nextbtnPlace").removeClass("allBtnCity").show();
    $(".homeDetails").hide();
  } else {
    $(".homeDetails").show();
    $(".nextbtnPlace").hide();
  }
});
